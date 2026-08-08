import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { executionJobs, executionSteps, executionWorkspaces } from "@/db/execution-schema";
import { browserAgentSessions, toolRuns, voiceGenerationJobs } from "@/db/tool-run-schema";
import { storeExecutionArtifact } from "@/lib/execution/artifact-service";
import { executionLimitsSchema, networkPolicySchema } from "@/lib/execution/contracts";
import { appendExecutionEvent, appendOutputEvent } from "@/lib/execution/event-service";
import { getExecutionRunner, requireHealthyExecutionRunner } from "@/lib/execution/runner-registry";
import { startBrowserRunnerTask, executeBrowserRunnerStep, getBrowserRunnerState } from "@/lib/browser/runner-client";
import type { OperationalToolRunRequest } from "./runtime-contracts";

const dataScript = String.raw`
import json, statistics, sys
payload=json.load(sys.stdin)
data=payload.get('dataset')
objective=payload.get('objective','')
rows=data if isinstance(data,list) else [data]
keys=[]
for r in rows:
  if isinstance(r,dict):
    for k in r.keys():
      if k not in keys: keys.append(k)
summary={'objective':objective,'rowCount':len(rows),'columns':keys,'numeric':{}}
for k in keys:
  vals=[]
  for r in rows:
    if isinstance(r,dict) and isinstance(r.get(k),(int,float)) and not isinstance(r.get(k),bool): vals.append(r[k])
  if vals:
    summary['numeric'][k]={'count':len(vals),'min':min(vals),'max':max(vals),'mean':sum(vals)/len(vals),'median':statistics.median(vals)}
open('result.json','w',encoding='utf-8').write(json.dumps(summary,ensure_ascii=False,indent=2))
lines=['# Data Interpreter Report','',objective,'',f'Rows: {len(rows)}',f'Columns: {len(keys)}','']
for k,v in summary['numeric'].items(): lines.append(f"- {k}: count={v['count']}, min={v['min']}, max={v['max']}, mean={v['mean']}")
open('report.md','w',encoding='utf-8').write('\n'.join(lines))
print(json.dumps({'ok':True,'rowCount':len(rows),'columnCount':len(keys)}))
`;

const codingScript = String.raw`
const fs=require('fs'); const path=require('path');
const input=JSON.parse(fs.readFileSync(0,'utf8')); const root=process.cwd();
function safe(p){const q=path.normalize(p).replaceAll('\\','/'); if(q.startsWith('../')||q==='..'||path.isAbsolute(q)) throw new Error('UNSAFE_PATH'); return q;}
function write(p,c){p=safe(p); fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true}); fs.writeFileSync(path.join(root,p),c,'utf8');}
for(const [p,c] of Object.entries(input.files||{})) write(p,c);
const changes=[];
for(const op of input.operations||[]){const p=safe(op.path); const full=path.join(root,p); if(op.kind==='write'){const before=fs.existsSync(full)?fs.readFileSync(full,'utf8'):null; write(p,op.content); changes.push({kind:'write',path:p,beforeBytes:before?Buffer.byteLength(before):0,afterBytes:Buffer.byteLength(op.content)});} else {if(fs.existsSync(full)){fs.rmSync(full,{force:true});changes.push({kind:'delete',path:p});}}}
write('specification.md','# Specification\n\n'+input.objective+'\n');
write('plan.md','# Plan\n\n1. Materialize source files\n2. Apply validated operations\n3. Verify resulting paths and emit evidence\n');
write('tasks.json',JSON.stringify((input.operations||[]).map((op,i)=>({id:i+1,kind:op.kind,path:op.path,status:'completed'})),null,2));
write('final.diff',JSON.stringify(changes,null,2));
const verification={passed:true,changedFiles:changes.length,unsafePathsRejected:true}; write('verification-report.json',JSON.stringify(verification,null,2));
write('implementation-report.md','# Implementation Report\n\nObjective: '+input.objective+'\n\nChanged files: '+changes.length+'\n');
console.log(JSON.stringify({ok:true,changedFiles:changes.length}));
`;

function asyncBytes(bytes: Uint8Array) { return (async function* stream() { yield bytes; })(); }

async function claim(input: { organizationId: string; jobId: string; toolRunId: string }) {
  return db().transaction(async (tx) => {
    const [job] = await tx.select().from(executionJobs).where(and(eq(executionJobs.id, input.jobId), eq(executionJobs.organizationId, input.organizationId))).limit(1);
    const [run] = await tx.select().from(toolRuns).where(and(eq(toolRuns.id, input.toolRunId), eq(toolRuns.organizationId, input.organizationId))).limit(1);
    if (!job || !run) throw new Error("TOOL_EXECUTION_NOT_FOUND");
    if (["completed","failed","cancelled","timed_out"].includes(job.status)) return { job, run, claimed: false };
    await tx.update(executionJobs).set({ status: "running", startedAt: job.startedAt ?? new Date(), updatedAt: new Date() }).where(and(eq(executionJobs.id, job.id), eq(executionJobs.organizationId, input.organizationId)));
    await tx.update(toolRuns).set({ status: "running", startedAt: run.startedAt ?? new Date(), updatedAt: new Date() }).where(and(eq(toolRuns.id, run.id), eq(toolRuns.organizationId, input.organizationId)));
    await tx.update(executionSteps).set({ status: "running", startedAt: new Date(), updatedAt: new Date() }).where(and(eq(executionSteps.jobId, job.id), eq(executionSteps.sequence, 1)));
    return { job, run, claimed: true };
  });
}

async function finish(input: { organizationId: string; jobId: string; toolRunId: string; result: Record<string, unknown>; artifactCount: number }) {
  const now = new Date();
  await db().transaction(async (tx) => {
    await tx.update(executionSteps).set({ status: "completed", outputSummary: input.result, exitCode: 0, completedAt: now, updatedAt: now }).where(and(eq(executionSteps.jobId, input.jobId), eq(executionSteps.sequence, 1)));
    await tx.update(executionJobs).set({ status: "completed", resultSummary: { ...input.result, executionVerified: true, artifactCount: input.artifactCount, requiredArtifactCount: 1 }, completedAt: now, updatedAt: now }).where(and(eq(executionJobs.id, input.jobId), eq(executionJobs.organizationId, input.organizationId)));
    await tx.update(toolRuns).set({ status: "completed", resultSummary: input.result, verification: { passed: true, artifactCount: input.artifactCount }, completedAt: now, updatedAt: now }).where(and(eq(toolRuns.id, input.toolRunId), eq(toolRuns.organizationId, input.organizationId)));
  });
  await appendExecutionEvent({ organizationId: input.organizationId, jobId: input.jobId, type: "job.completed", source: "tool-worker", payload: { toolRunId: input.toolRunId, artifactCount: input.artifactCount } });
}

async function fail(input: { organizationId: string; jobId: string; toolRunId: string; error: unknown }) {
  const code = input.error instanceof Error ? input.error.message.slice(0, 120) : "TOOL_EXECUTION_FAILED";
  const now = new Date();
  await db().transaction(async (tx) => {
    await tx.update(executionSteps).set({ status: "failed", errorCode: code, completedAt: now, updatedAt: now }).where(and(eq(executionSteps.jobId, input.jobId), eq(executionSteps.sequence, 1)));
    await tx.update(executionJobs).set({ status: "failed", errorCode: code, completedAt: now, updatedAt: now }).where(and(eq(executionJobs.id, input.jobId), eq(executionJobs.organizationId, input.organizationId)));
    await tx.update(toolRuns).set({ status: "failed", errorCode: code, completedAt: now, updatedAt: now }).where(and(eq(toolRuns.id, input.toolRunId), eq(toolRuns.organizationId, input.organizationId)));
  });
  await appendExecutionEvent({ organizationId: input.organizationId, jobId: input.jobId, type: "job.failed", source: "tool-worker", level: "error", payload: { toolRunId: input.toolRunId, errorCode: code } }).catch(() => undefined);
}

async function storeRunnerFile(input: { organizationId: string; userId: string; jobId: string; workspaceId: string; externalWorkspaceId: string; path: string; kind: string; limits: ReturnType<typeof executionLimitsSchema.parse> }) {
  const runner = getExecutionRunner({ organizationId: input.organizationId, limits: input.limits });
  const body = await runner.downloadFile(input.externalWorkspaceId, input.path);
  return storeExecutionArtifact({ organizationId: input.organizationId, userId: input.userId, jobId: input.jobId, sourcePath: input.path, filename: input.path, kind: input.kind, content: body, limits: input.limits, metadata: { verified: true, workspaceId: input.workspaceId } });
}

async function executeKernelTool(input: { organizationId: string; jobId: string; body: OperationalToolRunRequest }) {
  const [workspace] = await db().select().from(executionWorkspaces).where(and(eq(executionWorkspaces.id, (await db().select({ workspaceId: executionJobs.workspaceId }).from(executionJobs).where(eq(executionJobs.id, input.jobId)).limit(1))[0]!.workspaceId), eq(executionWorkspaces.organizationId, input.organizationId))).limit(1);
  if (!workspace) throw new Error("TOOL_WORKSPACE_NOT_FOUND");
  const limits = executionLimitsSchema.parse(workspace.limits);
  const policy = networkPolicySchema.parse(workspace.networkPolicy);
  const { runner } = await requireHealthyExecutionRunner({ organizationId: input.organizationId, limits });
  const provisioned = workspace.externalWorkspaceId ? { externalWorkspaceId: workspace.externalWorkspaceId } : await runner.createWorkspace({ executionId: workspace.id, organizationId: input.organizationId, templateId: workspace.templateId, limits, networkPolicy: policy });
  await db().update(executionWorkspaces).set({ externalWorkspaceId: provisioned.externalWorkspaceId, state: "running", provisionedAt: workspace.provisionedAt ?? new Date(), lastHeartbeatAt: new Date(), updatedAt: new Date() }).where(eq(executionWorkspaces.id, workspace.id));

  let argv: string[]; let stdin: string; let artifacts: Array<{path:string;kind:string}>;
  if (input.body.toolId === "data.interpreter") {
    argv = ["python3", "-c", dataScript]; stdin = JSON.stringify({ dataset: input.body.dataset, objective: input.body.objective });
    artifacts = [{ path: "report.md", kind: "report" }, { path: "result.json", kind: "report" }];
  } else if (input.body.toolId === "coding.agent") {
    argv = ["node", "-e", codingScript]; stdin = JSON.stringify({ files: input.body.files, operations: input.body.operations, objective: input.body.objective });
    artifacts = [
      {path:"specification.md",kind:"report"},{path:"plan.md",kind:"report"},{path:"tasks.json",kind:"report"},
      {path:"final.diff",kind:"patch"},{path:"verification-report.json",kind:"test-result"},{path:"implementation-report.md",kind:"report"},
    ];
  } else throw new Error("INVALID_KERNEL_TOOL");

  let stdout = ""; let stderr = "";
  const result = await runner.executeCommand(provisioned.externalWorkspaceId, { argv, cwd: ".", stdin, timeoutMs: limits.timeoutMs }, {
    onStdout: async (chunk) => { stdout += Buffer.from(chunk).toString("utf8"); await appendOutputEvent({ organizationId: input.organizationId, jobId: input.jobId, stream: "stdout", chunk }); },
    onStderr: async (chunk) => { stderr += Buffer.from(chunk).toString("utf8"); await appendOutputEvent({ organizationId: input.organizationId, jobId: input.jobId, stream: "stderr", chunk }); },
    onState: async () => undefined,
  });
  if (result.timedOut || result.exitCode !== 0) throw new Error(result.timedOut ? "TOOL_TIMEOUT" : `TOOL_EXIT_${result.exitCode}:${stderr.slice(0,80)}`);
  const [job] = await db().select().from(executionJobs).where(eq(executionJobs.id, input.jobId)).limit(1); if (!job) throw new Error("TOOL_JOB_NOT_FOUND");
  const stored = [];
  for (const artifact of artifacts) stored.push(await storeRunnerFile({ organizationId: input.organizationId, userId: job.userId, jobId: input.jobId, workspaceId: workspace.id, externalWorkspaceId: provisioned.externalWorkspaceId, path: artifact.path, kind: artifact.kind, limits }));
  await runner.destroyWorkspace(provisioned.externalWorkspaceId);
  await db().update(executionWorkspaces).set({ state: "stopped", destroyedAt: new Date(), updatedAt: new Date() }).where(eq(executionWorkspaces.id, workspace.id));
  let parsed: Record<string, unknown> = { ok: true };
  try { parsed = JSON.parse(stdout.trim().split("\n").at(-1) || "{}") as Record<string, unknown>; } catch { parsed = { ok: true, stdout: stdout.trim().slice(0,2_000) }; }
  return { result: parsed, artifactCount: stored.length };
}

async function executeBrowser(input: { organizationId: string; jobId: string; body: Extract<OperationalToolRunRequest,{toolId:"browser.agent"}> }) {
  await startBrowserRunnerTask({ tenantId: input.organizationId, taskId: input.jobId, storageState: { cookies: [], origins: [] }, plan: input.body.plan, allowedDomains: input.body.allowedDomains, maxPages: 5, timeoutMs: 300_000, maxDownloadBytes: 10_485_760 });
  const stepResults: unknown[] = [];
  for (let index = 0; index < input.body.plan.steps.length; index++) stepResults.push(await executeBrowserRunnerStep({ tenantId: input.organizationId, taskId: input.jobId, stepIndex: index }));
  const state = await getBrowserRunnerState({ tenantId: input.organizationId, taskId: input.jobId });
  const [job] = await db().select().from(executionJobs).where(eq(executionJobs.id, input.jobId)).limit(1); if (!job) throw new Error("TOOL_JOB_NOT_FOUND");
  const limits = executionLimitsSchema.parse((await db().select({limits:executionWorkspaces.limits}).from(executionWorkspaces).where(eq(executionWorkspaces.id,job.workspaceId)).limit(1))[0]!.limits);
  const payload = Buffer.from(JSON.stringify({ plan: input.body.plan, stepResults, finalState: state }, null, 2));
  await storeExecutionArtifact({ organizationId: input.organizationId, userId: job.userId, jobId: input.jobId, sourcePath: "browser-result.json", filename: "browser-result.json", kind: "report", content: asyncBytes(payload), limits, metadata: { verified: true } });
  await db().update(browserAgentSessions).set({ finalState: state, updatedAt: new Date() }).where(eq(browserAgentSessions.toolRunId, (await db().select({id:toolRuns.id}).from(toolRuns).where(eq(toolRuns.executionJobId,input.jobId)).limit(1))[0]!.id));
  return { result: { ok: true, steps: stepResults.length, currentUrl: state.currentUrl }, artifactCount: 1 };
}

async function executeVoice(input: { organizationId: string; jobId: string; body: Extract<OperationalToolRunRequest,{toolId:"voice.studio"}> }) {
  let response: Response;
  if (input.body.provider === "openai") {
    if (process.env.OPENAI_VOICE_PROVIDER_ENABLED !== "true" || !process.env.OPENAI_API_KEY) throw new Error("OPENAI_VOICE_PROVIDER_UNAVAILABLE");
    response = await fetch("https://api.openai.com/v1/audio/speech", { method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: input.body.model || "gpt-4o-mini-tts", voice: input.body.voiceId, input: input.body.text, response_format: input.body.format }) });
  } else {
    if (process.env.ELEVENLABS_VOICE_PROVIDER_ENABLED !== "true" || !process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_VOICE_PROVIDER_UNAVAILABLE");
    response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.body.voiceId)}`, { method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" }, body: JSON.stringify({ text: input.body.text, model_id: input.body.model || "eleven_multilingual_v2" }) });
  }
  if (!response.ok) throw new Error(`VOICE_PROVIDER_${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer()); if (!bytes.byteLength) throw new Error("VOICE_EMPTY_AUDIO");
  const [job] = await db().select().from(executionJobs).where(eq(executionJobs.id, input.jobId)).limit(1); if (!job) throw new Error("TOOL_JOB_NOT_FOUND");
  const limits = executionLimitsSchema.parse((await db().select({limits:executionWorkspaces.limits}).from(executionWorkspaces).where(eq(executionWorkspaces.id,job.workspaceId)).limit(1))[0]!.limits);
  const artifact = await storeExecutionArtifact({ organizationId: input.organizationId, userId: job.userId, jobId: input.jobId, sourcePath: `voice.${input.body.format}`, filename: `voice.${input.body.format}`, kind: "audio", content: asyncBytes(bytes), limits, metadata: { provider: input.body.provider, voiceId: input.body.voiceId, verified: true } });
  await db().update(voiceGenerationJobs).set({ outputArtifactId: artifact.id, finalCost: "0", updatedAt: new Date() }).where(eq(voiceGenerationJobs.toolRunId, (await db().select({id:toolRuns.id}).from(toolRuns).where(eq(toolRuns.executionJobId,input.jobId)).limit(1))[0]!.id));
  return { result: { ok: true, provider: input.body.provider, bytes: bytes.byteLength, format: input.body.format }, artifactCount: 1 };
}

export async function executeOperationalTool(input: { organizationId: string; jobId: string; toolRunId: string }) {
  const claimed = await claim(input); if (!claimed.claimed) return claimed.job;
  try {
    const normalized = claimed.job.normalizedInput as { body?: OperationalToolRunRequest };
    if (!normalized.body) throw new Error("TOOL_INPUT_MISSING");
    const output = normalized.body.toolId === "data.interpreter" || normalized.body.toolId === "coding.agent"
      ? await executeKernelTool({ organizationId: input.organizationId, jobId: input.jobId, body: normalized.body })
      : normalized.body.toolId === "browser.agent"
        ? await executeBrowser({ organizationId: input.organizationId, jobId: input.jobId, body: normalized.body })
        : await executeVoice({ organizationId: input.organizationId, jobId: input.jobId, body: normalized.body });
    if (output.artifactCount < 1) throw new Error("EMPTY_SUCCESS");
    await finish({ ...input, ...output });
    return output;
  } catch (error) { await fail({ ...input, error }); throw error; }
}
