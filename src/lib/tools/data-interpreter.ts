import { generateText } from "ai";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { executionJobs, executionWorkspaces } from "@/db/execution-schema";
import { dataInterpreterSessions, toolRuns } from "@/db/tool-run-schema";
import { attachments } from "@/db/schema";
import { createDirectLanguageModel } from "@/lib/ai-sdk/model-factory";
import { artifactRegistry } from "@/lib/execution/artifact-registry";
import { credentialBroker } from "@/lib/execution/credential-broker";
import { appendExecutionEvent } from "@/lib/execution/events";
import { getExecutionRunner } from "@/lib/execution/runner-registry";
import { markExecutionStatus, provisionExecutionWorkspace } from "@/lib/execution/service";
import { ApiError } from "@/lib/http/api";
import { readAttachmentContent } from "@/lib/storage/attachments";
import type { ToolHandlerContext } from "@/lib/tools/contracts";

const inputSchema = z.object({
  question: z.string().trim().min(3).max(8_000),
  attachmentIds: z.array(z.string().uuid()).min(1).max(8),
  providerCredentialId: z.string().uuid(),
  model: z.string().trim().min(1).max(300).optional(),
}).strict();

const planSchema = z.object({
  objective: z.string().min(1).max(2_000),
  datasets: z.array(z.string().min(1).max(300)).min(1).max(20),
  operations: z.array(z.string().min(1).max(500)).min(1).max(30),
  expectedOutputs: z.array(z.string().min(1).max(300)).min(1).max(20),
  validationChecks: z.array(z.string().min(1).max(500)).min(1).max(20),
  pythonCode: z.string().min(20).max(60_000),
}).strict();

type Plan = z.infer<typeof planSchema>;

const PROFILE_SCRIPT = String.raw`
import json, re, zipfile
from pathlib import Path
import pandas as pd

ROOT = Path('/workspace/input').resolve()
SENSITIVE = re.compile(r'(email|e-mail|phone|mobile|token|secret|password|passcode|api.?key|national.?id|ssn|identifier|\bid\b)', re.I)
SUPPORTED = {'.csv', '.tsv', '.xlsx', '.json', '.ndjson', '.txt'}

def safe_child(base, name):
    target = (base / name).resolve()
    if target != base and base not in target.parents:
        raise ValueError('unsafe archive path')
    return target

def load(path):
    ext = path.suffix.lower()
    if ext == '.csv': return pd.read_csv(path)
    if ext == '.tsv': return pd.read_csv(path, sep='\t')
    if ext == '.xlsx': return pd.read_excel(path)
    if ext == '.json':
        try: return pd.read_json(path)
        except ValueError: return pd.DataFrame(json.loads(path.read_text(encoding='utf-8')))
    if ext == '.ndjson': return pd.read_json(path, lines=True)
    if ext == '.txt': return pd.DataFrame({'text': path.read_text(encoding='utf-8', errors='replace').splitlines()})
    raise ValueError('unsupported')

def scalar(value, sensitive):
    if sensitive: return '<redacted>'
    if pd.isna(value): return None
    text = str(value)
    if '@' in text or re.fullmatch(r'\+?[\d\s().-]{7,}', text): return '<redacted>'
    return text[:160]

def profile(path):
    frame = load(path)
    cols = []
    for col in frame.columns:
        name = str(col)
        sensitive = bool(SENSITIVE.search(name))
        cols.append({
            'name': name[:160],
            'dtype': str(frame[col].dtype),
            'missing': int(frame[col].isna().sum()),
            'sensitive': sensitive,
        })
    sample = []
    for _, row in frame.head(3).iterrows():
        sample.append({str(col)[:160]: scalar(row[col], bool(SENSITIVE.search(str(col)))) for col in frame.columns[:40]})
    return {
        'file': path.name,
        'rows': int(len(frame)),
        'columns': cols[:200],
        'sample': sample,
    }

for archive in list(ROOT.glob('*.zip')):
    out = safe_child(ROOT, f'extracted_{archive.stem}')
    out.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as zf:
        if len(zf.infolist()) > 100:
            raise ValueError('archive has too many entries')
        total = 0
        for info in zf.infolist():
            if info.is_dir(): continue
            total += info.file_size
            if total > 50 * 1024 * 1024: raise ValueError('archive too large')
            target = safe_child(out, info.filename)
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, target.open('wb') as dst:
                while chunk := src.read(1024 * 1024): dst.write(chunk)

profiles = []
for path in sorted(ROOT.rglob('*')):
    if path.is_file() and path.suffix.lower() in SUPPORTED:
        profiles.append(profile(path))
Path('/workspace/dataset_profile.json').write_text(json.dumps({'datasets': profiles}, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'datasetCount': len(profiles), 'rows': sum(p['rows'] for p in profiles)}))
`;

function safeName(name: string) {
  const cleaned = name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120);
  return cleaned || "dataset";
}

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ApiError(502, "DATA_PLANNER_INVALID", "أعاد مخطط التحليل نتيجة غير صالحة.");
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

function assertSafePython(code: string) {
  const forbidden = [
    /\bsubprocess\b/i,
    /\bsocket\b/i,
    /\brequests\b/i,
    /\bhttpx\b/i,
    /\burllib\b/i,
    /os\.system\s*\(/i,
    /shutil\.rmtree\s*\(/i,
    /pip\s+install/i,
    /apt(?:-get)?\s+/i,
  ];
  if (forbidden.some((pattern) => pattern.test(code))) {
    throw new ApiError(422, "DATA_GENERATED_CODE_UNSAFE", "رفض النظام كود تحليل يحاول استخدام الشبكة أو عمليات نظام غير لازمة.");
  }
}

async function loadContext(context: ToolHandlerContext) {
  const [run] = await db().select().from(toolRuns).where(and(
    eq(toolRuns.id, context.toolRunId),
    eq(toolRuns.organizationId, context.actor.organizationId),
    eq(toolRuns.userId, context.actor.userId),
  )).limit(1);
  if (!run) throw new ApiError(404, "TOOL_RUN_NOT_FOUND", "تشغيل الأداة غير موجود.");
  const config = inputSchema.parse(run.configuration);
  const [job] = await db().select().from(executionJobs).where(and(
    eq(executionJobs.id, context.executionJobId), eq(executionJobs.organizationId, context.actor.organizationId),
  )).limit(1);
  if (!job) throw new ApiError(404, "EXECUTION_JOB_NOT_FOUND", "مهمة التنفيذ غير موجودة.");
  return { run, config, job };
}

async function modelFor(context: ToolHandlerContext, providerCredentialId: string, requestedModel?: string) {
  const credential = await credentialBroker.resolveProviderCredential({
    organizationId: context.actor.organizationId,
    providerCredentialId,
  });
  const modelName = requestedModel ?? credential.defaultModel ?? credential.discoveredModels[0] ?? credential.allowedModels[0];
  if (!modelName) throw new ApiError(409, "DATA_MODEL_UNAVAILABLE", "لا يوجد نموذج صالح لتخطيط التحليل.");
  const allowed = new Set([...credential.allowedModels, ...credential.discoveredModels].filter(Boolean));
  if (allowed.size && !allowed.has(modelName)) throw new ApiError(409, "DATA_MODEL_UNAVAILABLE", "النموذج المحدد غير متاح لهذا المزود.");
  return {
    credential,
    modelName,
    model: createDirectLanguageModel({
      provider: credential.provider,
      apiKey: credential.apiKey,
      baseUrl: credential.baseUrl,
      model: modelName,
      organizationId: context.actor.organizationId,
      providerTypeId: credential.providerTypeId,
      transportMode: credential.transportMode,
      gatewayId: credential.gatewayId ?? undefined,
      keyAlias: credential.keyAlias ?? undefined,
    }),
  };
}

async function askPlanner(input: {
  context: ToolHandlerContext;
  question: string;
  profile: string;
  providerCredentialId: string;
  model?: string;
  previousCode?: string;
  errorText?: string;
}): Promise<Plan> {
  const runtime = await modelFor(input.context, input.providerCredentialId, input.model);
  const repair = input.previousCode && input.errorText
    ? `\nالكود السابق:\n${input.previousCode.slice(0, 45_000)}\n\nخطأ التنفيذ المنقح:\n${input.errorText.slice(0, 8_000)}\nأصلح الكود فقط مع الحفاظ على الهدف.`
    : "";
  const result = await generateText({
    model: runtime.model,
    system: "أنت مخطط تحليل بيانات داخل Sandbox بلا شبكة. أعد JSON فقط ولا تستخدم Markdown. لا تطلب تثبيت حزم. استخدم فقط pandas,numpy,duckdb,pyarrow,openpyxl,matplotlib,PIL,scipy ومكتبة Python القياسية. يجب أن يكتب الكود report.md وresult.json غير فارغين، ويضع الرسوم في charts/ والبيانات المصدرة في output/. لا تقرأ مسارات خارج /workspace.",
    prompt: `سؤال المستخدم:\n${input.question}\n\nملف تعريف البيانات المنقح:\n${input.profile.slice(0, 35_000)}${repair}\n\nأعد كائن JSON مطابقًا للمفاتيح: objective,datasets,operations,expectedOutputs,validationChecks,pythonCode.`,
    temperature: 0.1,
    maxOutputTokens: 7_000,
    maxRetries: 0,
  });
  const plan = planSchema.parse(extractJson(result.text));
  assertSafePython(plan.pythonCode);
  return plan;
}

export async function runDataInterpreter(context: ToolHandlerContext) {
  const { config, job } = await loadContext(context);
  await markExecutionStatus({ organizationId: context.actor.organizationId, executionJobId: job.id, status: "running" });
  await db().update(toolRuns).set({ status: "running", updatedAt: new Date() }).where(eq(toolRuns.id, context.toolRunId));
  const workspace = await provisionExecutionWorkspace({ organizationId: context.actor.organizationId, executionJobId: job.id });
  if (!workspace?.externalWorkspaceRef || workspace.status !== "ready") throw new ApiError(503, "DATA_WORKSPACE_NOT_READY", "مساحة تحليل البيانات غير جاهزة.");
  const runner = getExecutionRunner(job.runnerKind);
  const runnerContext = {
    organizationId: context.actor.organizationId,
    userId: context.actor.userId,
    executionJobId: job.id,
    workspaceId: workspace.id,
    template: workspace.template,
    networkPolicy: workspace.networkPolicy,
    limits: workspace.limits,
    externalWorkspaceRef: workspace.externalWorkspaceRef,
  };
  const prepare = await runner.execute({ ...runnerContext, command: { command: "mkdir -p input charts output", idempotencyKey: "prepare-directories", timeoutMs: 10_000 } });
  if (prepare.status !== "completed" || prepare.exitCode !== 0) throw new ApiError(500, "DATA_WORKSPACE_PREPARE_FAILED", "تعذر تجهيز مساحة تحليل البيانات.");

  const rows = await db().select({
    id: attachments.id,
    filename: attachments.filename,
    mimeType: attachments.mimeType,
    sizeBytes: attachments.sizeBytes,
    content: attachments.content,
    storageDriver: attachments.storageDriver,
    objectKey: attachments.objectKey,
  }).from(attachments).where(and(
    eq(attachments.organizationId, context.actor.organizationId),
    inArray(attachments.id, config.attachmentIds),
    isNull(attachments.deletedAt),
  ));
  if (rows.length !== config.attachmentIds.length) throw new ApiError(404, "DATA_INPUT_NOT_FOUND", "أحد ملفات التحليل غير موجود.");
  const allowedExtensions = new Set(["csv", "tsv", "xlsx", "json", "ndjson", "txt", "zip"]);
  for (const row of rows) {
    const ext = row.filename.split(".").at(-1)?.toLowerCase() ?? "";
    if (!allowedExtensions.has(ext)) throw new ApiError(415, "DATA_INPUT_UNSUPPORTED", `الملف ${row.filename} ليس من صيغ البيانات المدعومة.`);
    const content = await readAttachmentContent(row);
    await runner.writeFile({ ...runnerContext, path: `input/${safeName(row.filename)}`, content });
  }
  await runner.writeFile({ ...runnerContext, path: "profile.py", content: Buffer.from(PROFILE_SCRIPT, "utf8") });
  const profiled = await runner.execute({
    ...runnerContext,
    command: { command: "/opt/moataz-data/bin/python profile.py", idempotencyKey: "dataset-profile-v1", timeoutMs: Math.min(120_000, job.limits.timeoutMs) },
  });
  if (profiled.status !== "completed" || profiled.exitCode !== 0) throw new ApiError(422, "DATA_PROFILE_FAILED", "تعذر قراءة ملفات البيانات ضمن الحدود الآمنة.");
  const profileFile = await runner.readFile({ ...runnerContext, path: "dataset_profile.json", maxBytes: 512 * 1024 });
  const profileText = Buffer.from(profileFile.content).toString("utf8").trim();
  if (!profileText) throw new ApiError(500, "DATA_PROFILE_EMPTY", "ملف تعريف البيانات فارغ.");
  JSON.parse(profileText);
  await artifactRegistry.registerBuffer({
    organizationId: context.actor.organizationId,
    userId: context.actor.userId,
    executionJobId: job.id,
    kind: "dataset_profile",
    filename: "dataset-profile.json",
    mimeType: "application/json",
    content: profileFile.content,
  });

  let plan = await askPlanner({
    context,
    question: config.question,
    profile: profileText,
    providerCredentialId: config.providerCredentialId,
    model: config.model,
  });
  let successful = false;
  let lastError = "";
  let analysisArtifactId: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await runner.writeFile({ ...runnerContext, path: "analysis.py", content: Buffer.from(plan.pythonCode, "utf8") });
    const codeArtifact = await artifactRegistry.registerBuffer({
      organizationId: context.actor.organizationId,
      userId: context.actor.userId,
      executionJobId: job.id,
      kind: "source",
      filename: "analysis.py",
      mimeType: "text/plain",
      content: Buffer.from(plan.pythonCode, "utf8"),
      metadata: { attempt },
      workspacePath: "analysis.py",
    });
    analysisArtifactId = codeArtifact.id;
    await appendExecutionEvent({ organizationId: context.actor.organizationId, executionJobId: job.id, type: "data.analysis_attempt", payload: { attempt } });
    const executed = await runner.execute({
      ...runnerContext,
      command: {
        command: "/opt/moataz-data/bin/python analysis.py",
        idempotencyKey: `analysis-attempt-${attempt}`,
        timeoutMs: job.limits.timeoutMs,
        maxOutputBytes: job.limits.maxOutputBytes,
      },
    });
    if (executed.status === "cancelled") throw new ApiError(409, "EXECUTION_CANCELLED", "تم إلغاء التحليل.");
    if (executed.status === "timed_out") throw new ApiError(504, "DATA_ANALYSIS_TIMEOUT", "انتهت مهلة تحليل البيانات.");
    if (executed.status === "completed" && executed.exitCode === 0) {
      successful = true;
      break;
    }
    lastError = executed.stderr.slice(-8_000) || executed.stdout.slice(-8_000) || "Python execution failed";
    if (attempt < 3) {
      plan = await askPlanner({
        context,
        question: config.question,
        profile: profileText,
        providerCredentialId: config.providerCredentialId,
        model: config.model,
        previousCode: plan.pythonCode,
        errorText: lastError,
      });
    }
  }
  if (!successful) throw new ApiError(422, "DATA_ANALYSIS_FAILED", "فشل كود التحليل بعد محاولات الإصلاح المحدودة.", { stderr: lastError.slice(0, 500) });

  await markExecutionStatus({ organizationId: context.actor.organizationId, executionJobId: job.id, status: "verifying" });
  const [reportFile, resultFile] = await Promise.all([
    runner.readFile({ ...runnerContext, path: "report.md", maxBytes: 2 * 1024 * 1024 }),
    runner.readFile({ ...runnerContext, path: "result.json", maxBytes: 2 * 1024 * 1024 }),
  ]);
  const report = Buffer.from(reportFile.content).toString("utf8").trim();
  const resultText = Buffer.from(resultFile.content).toString("utf8").trim();
  if (!report) throw new ApiError(422, "DATA_REPORT_EMPTY", "انتهى التحليل دون تقرير صالح.");
  if (!resultText) throw new ApiError(422, "DATA_RESULT_EMPTY", "انتهى التحليل دون نتيجة منظمة.");
  const structuredResult = JSON.parse(resultText) as Record<string, unknown>;
  const reportArtifact = await artifactRegistry.registerBuffer({ organizationId: context.actor.organizationId, userId: context.actor.userId, executionJobId: job.id, kind: "report", filename: "report.md", mimeType: "text/markdown", content: reportFile.content });
  const resultArtifact = await artifactRegistry.registerBuffer({ organizationId: context.actor.organizationId, userId: context.actor.userId, executionJobId: job.id, kind: "result", filename: "result.json", mimeType: "application/json", content: resultFile.content });

  const files = await runner.listFiles({ ...runnerContext, path: ".", depth: 3 });
  const produced: string[] = [];
  for (const file of files.filter((item) => !item.isDirectory).slice(0, 100)) {
    if (file.path.startsWith("charts/") && /\.(png|jpg|jpeg|webp)$/i.test(file.path) && produced.length < 10) {
      const mimeType = file.path.toLowerCase().endsWith(".png") ? "image/png" : file.path.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
      const artifact = await artifactRegistry.exportWorkspaceFile({ organizationId: context.actor.organizationId, userId: context.actor.userId, executionJobId: job.id, path: file.path, kind: "chart", mimeType });
      produced.push(artifact.id);
    } else if (file.path.startsWith("output/") && /\.(csv|json|xlsx|txt)$/i.test(file.path) && produced.length < 30) {
      const mimeType = file.path.endsWith(".csv") ? "text/csv" : file.path.endsWith(".json") ? "application/json" : file.path.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/plain";
      const artifact = await artifactRegistry.exportWorkspaceFile({ organizationId: context.actor.organizationId, userId: context.actor.userId, executionJobId: job.id, path: file.path, kind: "dataset", mimeType });
      produced.push(artifact.id);
    }
  }

  await db().insert(dataInterpreterSessions).values({
    organizationId: context.actor.organizationId,
    userId: context.actor.userId,
    toolRunId: context.toolRunId,
    workspaceId: workspace.id,
    activeDatasetArtifactIds: config.attachmentIds,
    generatedCodeArtifactId: analysisArtifactId,
    state: { plan: { objective: plan.objective, operations: plan.operations, validationChecks: plan.validationChecks } },
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
  }).onConflictDoUpdate({
    target: [dataInterpreterSessions.organizationId, dataInterpreterSessions.toolRunId],
    set: { generatedCodeArtifactId: analysisArtifactId, state: { plan: { objective: plan.objective, operations: plan.operations, validationChecks: plan.validationChecks } }, updatedAt: new Date() },
  });
  const summary = {
    objective: plan.objective,
    result: structuredResult,
    reportPreview: report.slice(0, 4_000),
    reportArtifactId: reportArtifact.id,
    resultArtifactId: resultArtifact.id,
    producedArtifactIds: produced,
  };
  await db().update(toolRuns).set({ status: "completed", resultSummary: summary, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(toolRuns.id, context.toolRunId), eq(toolRuns.organizationId, context.actor.organizationId)));
  await markExecutionStatus({ organizationId: context.actor.organizationId, executionJobId: job.id, status: "completed", result: summary });
}
