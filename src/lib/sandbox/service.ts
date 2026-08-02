import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { toolApprovalsRuntime } from "@/db/agent-runtime-schema";
import {
  conversationSandboxWorkspaces,
  sandboxEvents,
  sandboxExecutions,
  sandboxFiles,
  sandboxPermissions,
  sandboxWorkspaces,
} from "@/db/sandbox-schema";
import { agents, auditLogs, conversations } from "@/db/schema";
import { requestExternalToolApproval } from "@/lib/ai-sdk/external-approvals";
import { env } from "@/lib/config/env";
import { ApiError } from "@/lib/http/api";
import type {
  SandboxExecutionCreateInput,
  SandboxWorkspaceCreateInput,
} from "@/lib/sandbox/contracts";
import {
  DEFAULT_SANDBOX_POLICIES,
  SANDBOX_PERMISSION_ACTIONS,
  evaluateSandboxPolicy,
  normalizeWorkspacePath,
  summarizeSandboxCommand,
  type SandboxPermissionAction,
  type SandboxPermissionPolicy,
} from "@/lib/sandbox/policy";
import {
  deleteRunnerFile,
  listRunnerFiles,
  readRunnerFile,
  stopRunnerExecution,
  writeRunnerFile,
} from "@/lib/sandbox/runner-client";
import { encryptSecret } from "@/lib/security/encryption";
import {
  enqueueSandboxCreate,
  enqueueSandboxExecute,
  enqueueSandboxReset,
} from "@/worker/queue";

export type SandboxActor = {
  organizationId: string;
  userId: string;
  role: string;
};

const publicWorkspaceFields = {
  id: sandboxWorkspaces.id,
  organizationId: sandboxWorkspaces.organizationId,
  createdByUserId: sandboxWorkspaces.createdByUserId,
  name: sandboxWorkspaces.name,
  provider: sandboxWorkspaces.provider,
  template: sandboxWorkspaces.template,
  status: sandboxWorkspaces.status,
  networkMode: sandboxWorkspaces.networkMode,
  diskLimitBytes: sandboxWorkspaces.diskLimitBytes,
  lastActivityAt: sandboxWorkspaces.lastActivityAt,
  expiresAt: sandboxWorkspaces.expiresAt,
  errorCode: sandboxWorkspaces.errorCode,
  createdAt: sandboxWorkspaces.createdAt,
  updatedAt: sandboxWorkspaces.updatedAt,
};

const publicExecutionFields = {
  id: sandboxExecutions.id,
  organizationId: sandboxExecutions.organizationId,
  workspaceId: sandboxExecutions.workspaceId,
  conversationId: sandboxExecutions.conversationId,
  messageId: sandboxExecutions.messageId,
  requestedByUserId: sandboxExecutions.requestedByUserId,
  agentId: sandboxExecutions.agentId,
  commandSummary: sandboxExecutions.commandSummary,
  workingDirectory: sandboxExecutions.workingDirectory,
  status: sandboxExecutions.status,
  riskLevel: sandboxExecutions.riskLevel,
  policyDecision: sandboxExecutions.policyDecision,
  timeoutMs: sandboxExecutions.timeoutMs,
  exitCode: sandboxExecutions.exitCode,
  stdoutBytes: sandboxExecutions.stdoutBytes,
  stderrBytes: sandboxExecutions.stderrBytes,
  outputTruncated: sandboxExecutions.outputTruncated,
  errorCode: sandboxExecutions.errorCode,
  errorMessage: sandboxExecutions.errorMessage,
  cancelRequestedAt: sandboxExecutions.cancelRequestedAt,
  startedAt: sandboxExecutions.startedAt,
  completedAt: sandboxExecutions.completedAt,
  createdAt: sandboxExecutions.createdAt,
  updatedAt: sandboxExecutions.updatedAt,
};

export function assertSandboxEnabled() {
  if (!env().sandboxEnabled) {
    throw new ApiError(404, "FEATURE_DISABLED", "ميزة Sandbox غير مفعلة.");
  }
}

function permissionMap(overrides: SandboxWorkspaceCreateInput["permissions"]) {
  const map = { ...DEFAULT_SANDBOX_POLICIES } as Record<SandboxPermissionAction, SandboxPermissionPolicy>;
  for (const permission of overrides) map[permission.action] = permission.policy;
  return map;
}

async function scopedConversation(actor: SandboxActor, conversationId: string) {
  const [conversation] = await db().select({
    id: conversations.id,
    title: conversations.title,
    agentId: conversations.agentId,
    createdByUserId: conversations.createdByUserId,
    deletedAt: conversations.deletedAt,
  }).from(conversations).where(and(
    eq(conversations.id, conversationId),
    eq(conversations.organizationId, actor.organizationId),
    actor.role === "member" ? eq(conversations.createdByUserId, actor.userId) : undefined,
  )).limit(1);
  if (!conversation || conversation.deletedAt) {
    throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
  }
  return conversation;
}

async function scopedWorkspace(actor: SandboxActor, workspaceId: string, requireReady = true) {
  const [workspace] = await db().select({
    id: sandboxWorkspaces.id,
    createdByUserId: sandboxWorkspaces.createdByUserId,
    externalWorkspaceId: sandboxWorkspaces.externalWorkspaceId,
    status: sandboxWorkspaces.status,
    networkMode: sandboxWorkspaces.networkMode,
    template: sandboxWorkspaces.template,
  }).from(sandboxWorkspaces).where(and(
    eq(sandboxWorkspaces.id, workspaceId),
    eq(sandboxWorkspaces.organizationId, actor.organizationId),
    actor.role === "member" ? eq(sandboxWorkspaces.createdByUserId, actor.userId) : undefined,
  )).limit(1);
  if (!workspace) throw new ApiError(404, "SANDBOX_WORKSPACE_NOT_FOUND", "مساحة Sandbox غير موجودة.");
  if (requireReady && (workspace.status !== "ready" || !workspace.externalWorkspaceId)) {
    throw new ApiError(409, "SANDBOX_WORKSPACE_NOT_READY", "مساحة Sandbox ليست جاهزة بعد.");
  }
  return workspace;
}

async function resolvedPolicy(input: {
  actor: SandboxActor;
  workspaceId: string;
  agentId: string;
  action: SandboxPermissionAction;
  command?: string;
  timeoutMs?: number;
  networkMode: string;
}) {
  const [agent] = await db().select({ id: agents.id }).from(agents).where(and(
    eq(agents.id, input.agentId),
    eq(agents.organizationId, input.actor.organizationId),
  )).limit(1);
  if (!agent) throw new ApiError(422, "AGENT_UNAVAILABLE", "الوكيل غير موجود في المؤسسة الحالية.");
  const [permission] = await db().select({ policy: sandboxPermissions.policy })
    .from(sandboxPermissions).where(and(
      eq(sandboxPermissions.organizationId, input.actor.organizationId),
      eq(sandboxPermissions.workspaceId, input.workspaceId),
      eq(sandboxPermissions.agentId, input.agentId),
      eq(sandboxPermissions.action, input.action),
    )).limit(1);
  return evaluateSandboxPolicy({
    action: input.action,
    configuredPolicy: permission?.policy,
    command: input.command,
    timeoutMs: input.timeoutMs,
    networkMode: input.networkMode,
  });
}

export async function createSandboxWorkspace(input: {
  actor: SandboxActor;
  requestId: string;
  body: SandboxWorkspaceCreateInput;
}) {
  assertSandboxEnabled();
  const conversation = await scopedConversation(input.actor, input.body.conversationId);
  const agentId = input.body.agentId ?? conversation.agentId;
  const [agent] = await db().select({ id: agents.id }).from(agents).where(and(
    eq(agents.id, agentId),
    eq(agents.organizationId, input.actor.organizationId),
  )).limit(1);
  if (!agent) throw new ApiError(422, "AGENT_UNAVAILABLE", "الوكيل غير موجود في المؤسسة الحالية.");

  const [existing] = await db().select(publicWorkspaceFields).from(conversationSandboxWorkspaces)
    .innerJoin(sandboxWorkspaces, eq(sandboxWorkspaces.id, conversationSandboxWorkspaces.workspaceId))
    .where(and(
      eq(conversationSandboxWorkspaces.organizationId, input.actor.organizationId),
      eq(conversationSandboxWorkspaces.conversationId, conversation.id),
      eq(conversationSandboxWorkspaces.active, true),
      input.actor.role === "member" ? eq(sandboxWorkspaces.createdByUserId, input.actor.userId) : undefined,
    )).limit(1);
  if (existing) return existing;

  const workspaceId = randomUUID();
  const policies = permissionMap(input.body.permissions);
  const diskLimitBytes = env().sandboxWorkspaceDiskBytes;
  const now = new Date();
  const workspace = await db().transaction(async (tx) => {
    const [created] = await tx.insert(sandboxWorkspaces).values({
      id: workspaceId,
      organizationId: input.actor.organizationId,
      createdByUserId: input.actor.userId,
      name: input.body.name ?? conversation.title ?? "مساحة المحادثة",
      template: input.body.template,
      status: "provisioning",
      networkMode: "disabled",
      diskLimitBytes,
      lastActivityAt: now,
    }).returning(publicWorkspaceFields);
    if (!created) throw new Error("SANDBOX_WORKSPACE_CREATE_FAILED");
    await tx.insert(conversationSandboxWorkspaces).values({
      organizationId: input.actor.organizationId,
      conversationId: conversation.id,
      workspaceId,
      active: true,
    });
    await tx.insert(sandboxPermissions).values(
      SANDBOX_PERMISSION_ACTIONS.map((action) => ({
        organizationId: input.actor.organizationId,
        workspaceId,
        agentId,
        action,
        policy: policies[action],
      })),
    );
    await tx.insert(auditLogs).values({
      organizationId: input.actor.organizationId,
      actorType: "user",
      actorId: input.actor.userId,
      action: "sandbox.workspace_created",
      resourceType: "sandbox_workspace",
      resourceId: workspaceId,
      metadata: {
        conversationId: conversation.id,
        agentId,
        template: input.body.template,
        networkMode: "disabled",
        diskLimitBytes,
        requestId: input.requestId,
      },
    });
    return created;
  });
  const queued = await enqueueSandboxCreate({ organizationId: input.actor.organizationId, workspaceId });
  return { ...workspace, createJobId: queued.jobId };
}

export async function listSandboxWorkspaces(input: { actor: SandboxActor; conversationId?: string }) {
  assertSandboxEnabled();
  if (input.conversationId) await scopedConversation(input.actor, input.conversationId);
  return db().select({
    ...publicWorkspaceFields,
    conversationId: conversationSandboxWorkspaces.conversationId,
    active: conversationSandboxWorkspaces.active,
  }).from(sandboxWorkspaces)
    .leftJoin(conversationSandboxWorkspaces, and(
      eq(conversationSandboxWorkspaces.workspaceId, sandboxWorkspaces.id),
      eq(conversationSandboxWorkspaces.organizationId, input.actor.organizationId),
      eq(conversationSandboxWorkspaces.active, true),
    ))
    .where(and(
      eq(sandboxWorkspaces.organizationId, input.actor.organizationId),
      input.actor.role === "member" ? eq(sandboxWorkspaces.createdByUserId, input.actor.userId) : undefined,
      input.conversationId ? eq(conversationSandboxWorkspaces.conversationId, input.conversationId) : undefined,
    )).orderBy(desc(sandboxWorkspaces.updatedAt));
}

export async function createSandboxExecution(input: {
  actor: SandboxActor;
  requestId: string;
  body: SandboxExecutionCreateInput;
}) {
  assertSandboxEnabled();
  const conversation = await scopedConversation(input.actor, input.body.conversationId);
  const workspace = await scopedWorkspace(input.actor, input.body.workspaceId);
  const [link] = await db().select({ id: conversationSandboxWorkspaces.id })
    .from(conversationSandboxWorkspaces).where(and(
      eq(conversationSandboxWorkspaces.organizationId, input.actor.organizationId),
      eq(conversationSandboxWorkspaces.conversationId, conversation.id),
      eq(conversationSandboxWorkspaces.workspaceId, workspace.id),
      eq(conversationSandboxWorkspaces.active, true),
    )).limit(1);
  if (!link) throw new ApiError(403, "SANDBOX_CONVERSATION_MISMATCH", "مساحة Sandbox غير مرتبطة بهذه المحادثة.");

  const agentId = input.body.agentId ?? conversation.agentId;
  const timeoutMs = Math.min(input.body.timeoutMs ?? env().sandboxExecutionTimeoutMs, env().sandboxExecutionTimeoutMs);
  const decision = await resolvedPolicy({
    actor: input.actor,
    workspaceId: workspace.id,
    agentId,
    action: "exec",
    command: input.body.command,
    timeoutMs,
    networkMode: workspace.networkMode,
  });
  if (decision.outcome === "deny") {
    await db().insert(auditLogs).values({
      organizationId: input.actor.organizationId,
      actorType: "user",
      actorId: input.actor.userId,
      action: "sandbox.execution_denied",
      resourceType: "sandbox_workspace",
      resourceId: workspace.id,
      metadata: { agentId, risk: decision.risk, reasons: decision.reasons, requestId: input.requestId },
    });
    throw new ApiError(403, "SANDBOX_COMMAND_DENIED", "سياسة Sandbox تمنع هذا الأمر.", {
      risk: decision.risk,
      reasons: decision.reasons,
    });
  }

  const [activeCount] = await db().select({ value: count() }).from(sandboxExecutions).where(and(
    eq(sandboxExecutions.organizationId, input.actor.organizationId),
    inArray(sandboxExecutions.status, ["queued", "awaiting_approval", "running"]),
  ));
  if ((activeCount?.value ?? 0) >= env().sandboxMaxConcurrentPerOrganization) {
    throw new ApiError(429, "SANDBOX_ORGANIZATION_LIMIT", "وصلت المؤسسة إلى الحد الأقصى لعمليات Sandbox المتزامنة.");
  }

  const [existing] = await db().select(publicExecutionFields).from(sandboxExecutions).where(and(
    eq(sandboxExecutions.organizationId, input.actor.organizationId),
    eq(sandboxExecutions.idempotencyKey, input.body.idempotencyKey),
  )).limit(1);
  if (existing) return existing;

  const executionId = randomUUID();
  const encryptedCommand = encryptSecret(
    input.body.command,
    `sandbox-command:${input.actor.organizationId}:${executionId}`,
  );
  const status = decision.outcome === "require_approval" ? "awaiting_approval" : "queued";
  const created = await db().transaction(async (tx) => {
    const [row] = await tx.insert(sandboxExecutions).values({
      id: executionId,
      organizationId: input.actor.organizationId,
      workspaceId: workspace.id,
      conversationId: conversation.id,
      messageId: input.body.messageId,
      requestedByUserId: input.actor.userId,
      agentId,
      encryptedCommand,
      commandSummary: summarizeSandboxCommand(input.body.command),
      workingDirectory: normalizeWorkspacePath(input.body.workingDirectory),
      status,
      riskLevel: decision.risk,
      policyDecision: decision,
      idempotencyKey: input.body.idempotencyKey,
      timeoutMs,
    }).returning(publicExecutionFields);
    if (!row) throw new Error("SANDBOX_EXECUTION_CREATE_FAILED");
    await tx.insert(sandboxEvents).values({
      organizationId: input.actor.organizationId,
      executionId,
      sequence: 1,
      type: "status",
      payload: { status, risk: decision.risk },
    });
    await tx.update(sandboxWorkspaces).set({ lastActivityAt: new Date(), updatedAt: new Date() }).where(and(
      eq(sandboxWorkspaces.id, workspace.id),
      eq(sandboxWorkspaces.organizationId, input.actor.organizationId),
    ));
    await tx.insert(auditLogs).values({
      organizationId: input.actor.organizationId,
      actorType: "user",
      actorId: input.actor.userId,
      action: decision.outcome === "require_approval" ? "sandbox.approval_requested" : "sandbox.execution_queued",
      resourceType: "sandbox_execution",
      resourceId: executionId,
      metadata: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        messageId: input.body.messageId ?? null,
        agentId,
        risk: decision.risk,
        reasons: decision.reasons,
        requestId: input.requestId,
      },
    });
    return row;
  });

  if (decision.outcome === "require_approval") {
    const approval = await requestExternalToolApproval({
      organizationId: input.actor.organizationId,
      requestedByUserId: input.actor.userId,
      agentId,
      toolId: "sandbox.exec",
      arguments: { command: input.body.command, workingDirectory: created.workingDirectory, timeoutMs },
      reason: decision.reasons.length
        ? `يتطلب الأمر موافقة بسبب: ${decision.reasons.join(", ")}`
        : "تتطلب سياسة تنفيذ الأوامر موافقة بشرية.",
      risk: decision.risk,
      capability: "sandbox.exec",
      actionSnapshot: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        commandSummary: created.commandSummary,
        workingDirectory: created.workingDirectory,
        timeoutMs,
      },
      sandboxExecutionId: executionId,
    });
    return { ...created, approvalId: approval.approvalId };
  }

  const queued = await enqueueSandboxExecute({ organizationId: input.actor.organizationId, executionId });
  return { ...created, executeJobId: queued.jobId };
}

export async function listSandboxExecutions(input: {
  actor: SandboxActor;
  conversationId?: string;
  workspaceId?: string;
  limit?: number;
}) {
  assertSandboxEnabled();
  if (input.conversationId) await scopedConversation(input.actor, input.conversationId);
  if (input.workspaceId) await scopedWorkspace(input.actor, input.workspaceId, false);
  return db().select(publicExecutionFields).from(sandboxExecutions).where(and(
    eq(sandboxExecutions.organizationId, input.actor.organizationId),
    input.actor.role === "member" ? eq(sandboxExecutions.requestedByUserId, input.actor.userId) : undefined,
    input.conversationId ? eq(sandboxExecutions.conversationId, input.conversationId) : undefined,
    input.workspaceId ? eq(sandboxExecutions.workspaceId, input.workspaceId) : undefined,
  )).orderBy(desc(sandboxExecutions.createdAt)).limit(Math.min(200, Math.max(1, input.limit ?? 50)));
}

export async function cancelSandboxExecution(input: {
  actor: SandboxActor;
  executionId: string;
  requestId: string;
}) {
  assertSandboxEnabled();
  const [execution] = await db().select({
    id: sandboxExecutions.id,
    workspaceId: sandboxExecutions.workspaceId,
    requestedByUserId: sandboxExecutions.requestedByUserId,
    externalExecutionId: sandboxExecutions.externalExecutionId,
    status: sandboxExecutions.status,
  }).from(sandboxExecutions).where(and(
    eq(sandboxExecutions.id, input.executionId),
    eq(sandboxExecutions.organizationId, input.actor.organizationId),
    input.actor.role === "member" ? eq(sandboxExecutions.requestedByUserId, input.actor.userId) : undefined,
  )).limit(1);
  if (!execution) throw new ApiError(404, "SANDBOX_EXECUTION_NOT_FOUND", "عملية Sandbox غير موجودة.");
  if (["completed", "failed", "cancelled", "timed_out"].includes(execution.status)) return { cancelled: false, status: execution.status };
  const workspace = await scopedWorkspace(input.actor, execution.workspaceId, false);
  const now = new Date();
  await db().transaction(async (tx) => {
    await tx.update(sandboxExecutions).set({
      cancelRequestedAt: now,
      ...(execution.status === "queued" || execution.status === "awaiting_approval" ? { status: "cancelled" as const, completedAt: now } : {}),
      updatedAt: now,
    }).where(and(
      eq(sandboxExecutions.id, execution.id),
      eq(sandboxExecutions.organizationId, input.actor.organizationId),
    ));
    await tx.update(toolApprovalsRuntime).set({ status: "expired", updatedAt: now }).where(and(
      eq(toolApprovalsRuntime.organizationId, input.actor.organizationId),
      eq(toolApprovalsRuntime.sandboxExecutionId, execution.id),
      eq(toolApprovalsRuntime.status, "pending"),
    ));
    await tx.insert(auditLogs).values({
      organizationId: input.actor.organizationId,
      actorType: "user",
      actorId: input.actor.userId,
      action: "sandbox.execution_cancelled",
      resourceType: "sandbox_execution",
      resourceId: execution.id,
      metadata: { workspaceId: workspace.id, previousStatus: execution.status, requestId: input.requestId },
    });
  });
  if (execution.status === "running" && workspace.externalWorkspaceId && execution.externalExecutionId) {
    await stopRunnerExecution({
      tenantId: input.actor.organizationId,
      externalWorkspaceId: workspace.externalWorkspaceId,
      externalExecutionId: execution.externalExecutionId,
    }).catch(() => undefined);
  }
  return { cancelled: true, status: execution.status === "running" ? "cancelling" : "cancelled" };
}

export async function resetSandboxWorkspace(input: { actor: SandboxActor; workspaceId: string; requestId: string }) {
  assertSandboxEnabled();
  const workspace = await scopedWorkspace(input.actor, input.workspaceId, false);
  const [running] = await db().select({ value: count() }).from(sandboxExecutions).where(and(
    eq(sandboxExecutions.organizationId, input.actor.organizationId),
    eq(sandboxExecutions.workspaceId, workspace.id),
    inArray(sandboxExecutions.status, ["queued", "awaiting_approval", "running"]),
  ));
  if ((running?.value ?? 0) > 0) throw new ApiError(409, "SANDBOX_WORKSPACE_BUSY", "أوقف العمليات النشطة قبل إعادة ضبط المساحة.");
  await db().update(sandboxWorkspaces).set({ status: "resetting", updatedAt: new Date() }).where(and(
    eq(sandboxWorkspaces.id, workspace.id),
    eq(sandboxWorkspaces.organizationId, input.actor.organizationId),
  ));
  await db().insert(auditLogs).values({
    organizationId: input.actor.organizationId,
    actorType: "user",
    actorId: input.actor.userId,
    action: "sandbox.workspace_reset_requested",
    resourceType: "sandbox_workspace",
    resourceId: workspace.id,
    metadata: { requestId: input.requestId },
  });
  const queued = await enqueueSandboxReset({ organizationId: input.actor.organizationId, workspaceId: workspace.id });
  return { accepted: true, jobId: queued.jobId };
}

export async function terminateSandboxWorkspace(input: { actor: SandboxActor; workspaceId: string; requestId: string }) {
  assertSandboxEnabled();
  const workspace = await scopedWorkspace(input.actor, input.workspaceId, false);
  const [running] = await db().select({ id: sandboxExecutions.id }).from(sandboxExecutions).where(and(
    eq(sandboxExecutions.organizationId, input.actor.organizationId),
    eq(sandboxExecutions.workspaceId, workspace.id),
    inArray(sandboxExecutions.status, ["queued", "awaiting_approval", "running"]),
  )).limit(1);
  if (running) throw new ApiError(409, "SANDBOX_WORKSPACE_BUSY", "أوقف العمليات النشطة قبل إنهاء المساحة.");
  await db().transaction(async (tx) => {
    await tx.update(conversationSandboxWorkspaces).set({ active: false, updatedAt: new Date() }).where(and(
      eq(conversationSandboxWorkspaces.organizationId, input.actor.organizationId),
      eq(conversationSandboxWorkspaces.workspaceId, workspace.id),
    ));
    await tx.update(sandboxWorkspaces).set({ status: "terminated", updatedAt: new Date() }).where(and(
      eq(sandboxWorkspaces.id, workspace.id),
      eq(sandboxWorkspaces.organizationId, input.actor.organizationId),
    ));
    await tx.insert(auditLogs).values({
      organizationId: input.actor.organizationId,
      actorType: "user",
      actorId: input.actor.userId,
      action: "sandbox.workspace_terminated",
      resourceType: "sandbox_workspace",
      resourceId: workspace.id,
      metadata: { requestId: input.requestId },
    });
  });
  return { terminated: true, id: workspace.id };
}

export async function listSandboxFiles(input: { actor: SandboxActor; workspaceId: string; path: string; depth: number }) {
  assertSandboxEnabled();
  const workspace = await scopedWorkspace(input.actor, input.workspaceId);
  const result = await listRunnerFiles({
    tenantId: input.actor.organizationId,
    externalWorkspaceId: workspace.externalWorkspaceId!,
    path: normalizeWorkspacePath(input.path),
    depth: input.depth,
  });
  if (result.files.length) {
    await db().insert(sandboxFiles).values(result.files.map((file) => ({
      organizationId: input.actor.organizationId,
      workspaceId: workspace.id,
      path: file.path,
      mimeType: file.mimeType ?? null,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256 ?? null,
      isDirectory: file.isDirectory,
      modifiedAt: file.modifiedAt ? new Date(file.modifiedAt) : null,
    }))).onConflictDoUpdate({
      target: [sandboxFiles.workspaceId, sandboxFiles.path],
      set: { updatedAt: new Date() },
    });
  }
  return result.files;
}

export async function readSandboxFile(input: { actor: SandboxActor; workspaceId: string; path: string; maxBytes: number }) {
  assertSandboxEnabled();
  const workspace = await scopedWorkspace(input.actor, input.workspaceId);
  return readRunnerFile({
    tenantId: input.actor.organizationId,
    externalWorkspaceId: workspace.externalWorkspaceId!,
    path: normalizeWorkspacePath(input.path),
    maxBytes: input.maxBytes,
  });
}

export async function writeSandboxFile(input: {
  actor: SandboxActor;
  workspaceId: string;
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  overwrite: boolean;
  requestId: string;
}) {
  assertSandboxEnabled();
  const workspace = await scopedWorkspace(input.actor, input.workspaceId);
  const result = await writeRunnerFile({
    tenantId: input.actor.organizationId,
    externalWorkspaceId: workspace.externalWorkspaceId!,
    path: normalizeWorkspacePath(input.path),
    content: input.content,
    encoding: input.encoding,
    overwrite: input.overwrite,
  });
  await db().insert(auditLogs).values({
    organizationId: input.actor.organizationId,
    actorType: "user",
    actorId: input.actor.userId,
    action: "sandbox.file_written",
    resourceType: "sandbox_workspace",
    resourceId: workspace.id,
    metadata: { path: result.path, sizeBytes: result.sizeBytes, overwrite: input.overwrite, requestId: input.requestId },
  });
  return result;
}

export async function deleteSandboxFile(input: {
  actor: SandboxActor;
  workspaceId: string;
  path: string;
  recursive: boolean;
  requestId: string;
}) {
  assertSandboxEnabled();
  const workspace = await scopedWorkspace(input.actor, input.workspaceId);
  const path = normalizeWorkspacePath(input.path);
  if (path === "." || (input.recursive && path.split("/").length < 2)) {
    throw new ApiError(403, "SANDBOX_BROAD_DELETE_DENIED", "لا يمكن حذف جذر المساحة أو نطاق واسع من الملفات عبر هذه العملية.");
  }
  const result = await deleteRunnerFile({
    tenantId: input.actor.organizationId,
    externalWorkspaceId: workspace.externalWorkspaceId!,
    path,
    recursive: input.recursive,
  });
  await db().transaction(async (tx) => {
    await tx.delete(sandboxFiles).where(and(
      eq(sandboxFiles.organizationId, input.actor.organizationId),
      eq(sandboxFiles.workspaceId, workspace.id),
      or(eq(sandboxFiles.path, path), input.recursive ? eq(sandboxFiles.path, path) : undefined),
    ));
    await tx.insert(auditLogs).values({
      organizationId: input.actor.organizationId,
      actorType: "user",
      actorId: input.actor.userId,
      action: "sandbox.file_deleted",
      resourceType: "sandbox_workspace",
      resourceId: workspace.id,
      metadata: { path, recursive: input.recursive, requestId: input.requestId },
    });
  });
  return result;
}
