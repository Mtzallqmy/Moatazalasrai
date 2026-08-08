import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, checkDatabase } from "@/db";
import { executionEvents, executionJobs, executionSteps, executionUsage, executionWorkspaces } from "@/db/execution-schema";
import {
  browserAgentSessions,
  codingAgentRuns,
  codingProjects,
  dataInterpreterSessions,
  toolRuns,
  voiceGenerationJobs,
} from "@/db/tool-run-schema";
import { auditLogs } from "@/db/schema";
import type { Role } from "@/lib/auth/permissions";
import { platformExecutionLimits } from "@/lib/execution/quota-service";
import { enqueueExecutionTaskTx, type ExecutionActor } from "@/lib/execution/repository";
import { executionRunnerHealth } from "@/lib/execution/runner-health";
import { assertExecutionKernelEnabled, selectedRunnerKind } from "@/lib/execution/runner-registry";
import { getToolAvailability } from "./permission-service";
import { requireToolManifest } from "./registry";
import type { OperationalToolRunRequest } from "./runtime-contracts";

function ttlSeconds() {
  const value = Number(process.env.EXECUTION_WORKSPACE_TTL_SECONDS ?? 1_800);
  return Number.isSafeInteger(value) ? Math.min(Math.max(value, 300), 86_400) : 1_800;
}

function toolLimits(toolId: OperationalToolRunRequest["toolId"]) {
  const base = platformExecutionLimits();
  const manifest = requireToolManifest(toolId);
  return {
    ...base,
    timeoutMs: Math.min(base.timeoutMs, manifest.defaultLimits.timeoutMs),
    memoryBytes: Math.min(base.memoryBytes, manifest.defaultLimits.memoryBytes),
    diskBytes: Math.min(base.diskBytes, manifest.defaultLimits.diskBytes),
    maxArtifactBytes: Math.min(base.maxArtifactBytes, manifest.defaultLimits.maxArtifactBytes),
  };
}

function networkPolicy(toolId: OperationalToolRunRequest["toolId"], body: OperationalToolRunRequest) {
  if (toolId === "browser.agent" && body.toolId === "browser.agent") {
    return { mode: "allowlist" as const, allowedHosts: body.allowedDomains, allowedPorts: [80, 443], allowDns: true, allowedMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"], maxRequests: 1_000 };
  }
  return { mode: "deny_all" as const, allowedHosts: [], allowedPorts: [], allowDns: false, allowedMethods: ["GET", "HEAD"], maxRequests: 0 };
}

function voiceProviderAvailable(body: Extract<OperationalToolRunRequest, { toolId: "voice.studio" }>) {
  return body.provider === "openai"
    ? process.env.OPENAI_VOICE_PROVIDER_ENABLED === "true" && Boolean(process.env.OPENAI_API_KEY)
    : process.env.ELEVENLABS_VOICE_PROVIDER_ENABLED === "true" && Boolean(process.env.ELEVENLABS_API_KEY);
}

function browserRuntimeAvailable() {
  return process.env.BROWSER_AGENT_ENABLED === "true" && Boolean(process.env.BROWSER_RUNNER_URL) && Boolean(process.env.BROWSER_RUNNER_SHARED_SECRET);
}

export async function createOperationalToolRun(input: {
  actor: ExecutionActor & { role: Role };
  requestId: string;
  body: OperationalToolRunRequest;
}) {
  if (input.body.toolId === "data.interpreter" || input.body.toolId === "coding.agent") assertExecutionKernelEnabled();
  const manifest = requireToolManifest(input.body.toolId);
  let runnerHealthy = true;
  if (input.body.toolId === "data.interpreter" || input.body.toolId === "coding.agent") {
    try { runnerHealthy = (await executionRunnerHealth(input.actor.organizationId)).ready; } catch { runnerHealthy = false; }
  } else if (input.body.toolId === "browser.agent") {
    runnerHealthy = browserRuntimeAvailable();
  }
  const providerAvailable = input.body.toolId === "voice.studio" ? voiceProviderAvailable(input.body) : true;
  let migrationsApplied = false;
  try { await checkDatabase(); migrationsApplied = true; } catch { migrationsApplied = false; }
  const availability = await getToolAvailability({
    organizationId: input.actor.organizationId,
    userId: input.actor.userId,
    role: input.actor.role,
    manifest,
    runnerHealthy,
    providerAvailable,
    migrationsApplied,
  });
  if (!availability.runnable) throw new Error(`TOOL_NOT_RUNNABLE:${availability.reasons.join(",")}`);

  const limits = toolLimits(input.body.toolId);
  const policy = networkPolicy(input.body.toolId, input.body);
  const runnerKind = selectedRunnerKind();
  const lockKey = `${input.actor.organizationId}:${input.body.idempotencyKey}`;

  return db().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const [existingJob] = await tx.select().from(executionJobs).where(and(
      eq(executionJobs.organizationId, input.actor.organizationId),
      eq(executionJobs.idempotencyKey, input.body.idempotencyKey),
    )).limit(1);
    if (existingJob) {
      const [existingRun] = await tx.select().from(toolRuns).where(and(
        eq(toolRuns.organizationId, input.actor.organizationId),
        eq(toolRuns.executionJobId, existingJob.id),
      )).limit(1);
      return { job: existingJob, run: existingRun, duplicate: true };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds() * 1_000);
    const workspaceId = randomUUID();
    const jobId = randomUUID();
    const toolRunId = randomUUID();
    const templateId = input.body.toolId === "data.interpreter"
      ? (process.env.DATA_INTERPRETER_TEMPLATE_ID || "python-data-v1")
      : input.body.toolId === "coding.agent"
        ? (process.env.CODING_AGENT_TEMPLATE_ID || "coding-node-python-v1")
        : input.body.toolId === "browser.agent" ? "browser-agent-v1" : "voice-provider-v1";

    const [workspace] = await tx.insert(executionWorkspaces).values({
      id: workspaceId,
      organizationId: input.actor.organizationId,
      userId: input.actor.userId,
      runnerKind,
      templateId,
      state: input.body.toolId === "voice.studio" || input.body.toolId === "browser.agent" ? "ready" : "provisioning",
      networkPolicy: policy,
      limits,
      metadata: { requestId: input.requestId, toolId: input.body.toolId },
      expiresAt,
    }).returning();
    if (!workspace) throw new Error("TOOL_WORKSPACE_CREATE_FAILED");

    const [job] = await tx.insert(executionJobs).values({
      id: jobId,
      organizationId: input.actor.organizationId,
      userId: input.actor.userId,
      workspaceId,
      kind: `tool.${input.body.toolId}`,
      status: "queued",
      idempotencyKey: input.body.idempotencyKey,
      requestedInput: input.body,
      normalizedInput: { toolId: input.body.toolId, body: input.body, networkPolicy: policy, limits },
      resultSummary: { executionVerified: false, requiredArtifactCount: 1 },
      maxAttempts: input.body.toolId === "coding.agent" ? 5 : 3,
      expiresAt,
    }).returning();
    if (!job) throw new Error("TOOL_EXECUTION_CREATE_FAILED");

    await tx.insert(executionSteps).values({
      jobId,
      sequence: 1,
      kind: `tool.${input.body.toolId}`,
      status: "queued",
      inputSummary: { toolId: input.body.toolId, title: input.body.title },
      commandSpec: { trustedRuntime: true, toolId: input.body.toolId },
    });
    await tx.insert(executionUsage).values({ organizationId: input.actor.organizationId, userId: input.actor.userId, jobId });
    const [run] = await tx.insert(toolRuns).values({
      id: toolRunId,
      organizationId: input.actor.organizationId,
      userId: input.actor.userId,
      toolId: input.body.toolId,
      toolVersion: manifest.version,
      executionJobId: jobId,
      status: "queued",
      title: input.body.title,
      inputSummary: { toolId: input.body.toolId },
      config: {},
      verification: { passed: false },
    }).returning();
    if (!run) throw new Error("TOOL_RUN_CREATE_FAILED");

    if (input.body.toolId === "data.interpreter") {
      await tx.insert(dataInterpreterSessions).values({ organizationId: input.actor.organizationId, toolRunId, workspaceId, datasetProfile: {}, plannerOutput: { objective: input.body.objective } });
    } else if (input.body.toolId === "coding.agent") {
      const [project] = await tx.insert(codingProjects).values({ organizationId: input.actor.organizationId, userId: input.actor.userId, name: input.body.title, sourceKind: "inline", metadata: { fileCount: Object.keys(input.body.files).length } }).returning();
      if (!project) throw new Error("CODING_PROJECT_CREATE_FAILED");
      await tx.insert(codingAgentRuns).values({ organizationId: input.actor.organizationId, toolRunId, projectId: project.id, engine: process.env.CODING_AGENT_ENGINE || "internal" });
    } else if (input.body.toolId === "browser.agent") {
      await tx.insert(browserAgentSessions).values({ organizationId: input.actor.organizationId, toolRunId, workspaceId, engine: "playwright", startUrl: input.body.startUrl, allowedHosts: input.body.allowedDomains, plan: input.body.plan, expiresAt });
    } else {
      await tx.insert(voiceGenerationJobs).values({ organizationId: input.actor.organizationId, toolRunId, provider: input.body.provider, voiceId: input.body.voiceId, characterCount: input.body.text.length, chunkCount: 1, estimatedCost: "0", profile: { format: input.body.format, model: input.body.model ?? null } });
    }

    await tx.insert(executionEvents).values([
      { jobId, sequence: 1, eventType: "job.created", source: "api", payload: { kind: job.kind, toolRunId, requestId: input.requestId } },
      { jobId, sequence: 2, eventType: "job.queued", source: "api", payload: { queue: "operational-tools" } },
    ]);
    await enqueueExecutionTaskTx(tx, { task: "operational-tool-execute", payload: { organizationId: input.actor.organizationId, jobId, toolRunId }, queueName: "operational-tools", jobKey: `tool:execute:${jobId}`, maxAttempts: job.maxAttempts });
    await tx.insert(auditLogs).values({ organizationId: input.actor.organizationId, actorType: "user", actorId: input.actor.userId, action: "tool_run.created", resourceType: "tool_run", resourceId: toolRunId, metadata: { requestId: input.requestId, toolId: input.body.toolId, executionJobId: jobId } });
    return { job, run, duplicate: false };
  });
}
