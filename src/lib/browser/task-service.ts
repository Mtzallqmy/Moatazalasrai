import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { browserTasksRuntime } from "@/db/browser-runtime-schema";
import {
  agentSiteConnections,
  browserTaskSteps,
  siteConnections,
} from "@/db/site-connections-schema";
import { agents, auditLogs } from "@/db/schema";
import type { z } from "zod";
import type { browserTaskCreateSchema } from "@/lib/browser/contracts";
import { cancelBrowserRunnerTask } from "@/lib/browser/runner-client";
import { env } from "@/lib/config/env";
import { ApiError } from "@/lib/http/api";
import { enqueueBrowserTask } from "@/worker/queue";

export type BrowserTaskCreateInput = z.infer<typeof browserTaskCreateSchema>;

const publicTaskFields = {
  id: browserTasksRuntime.id,
  organizationId: browserTasksRuntime.organizationId,
  userId: browserTasksRuntime.userId,
  agentId: browserTasksRuntime.agentId,
  siteConnectionId: browserTasksRuntime.siteConnectionId,
  instruction: browserTasksRuntime.instruction,
  status: browserTasksRuntime.status,
  riskLevel: browserTasksRuntime.riskLevel,
  plan: browserTasksRuntime.plan,
  currentStep: browserTasksRuntime.currentStep,
  errorCode: browserTasksRuntime.errorCode,
  errorMessage: browserTasksRuntime.errorMessage,
  cancelRequestedAt: browserTasksRuntime.cancelRequestedAt,
  startedAt: browserTasksRuntime.startedAt,
  completedAt: browserTasksRuntime.completedAt,
  cancelledAt: browserTasksRuntime.cancelledAt,
  expiresAt: browserTasksRuntime.expiresAt,
  createdAt: browserTasksRuntime.createdAt,
  updatedAt: browserTasksRuntime.updatedAt,
};

export function assertBrowserAgentEnabled() {
  if (!env().browserAgentEnabled) {
    throw new ApiError(404, "FEATURE_DISABLED", "ميزة متصفح الوكيل غير مفعلة.");
  }
}

export async function createBrowserTask(input: {
  organizationId: string;
  userId: string;
  requestId: string;
  body: BrowserTaskCreateInput;
}) {
  assertBrowserAgentEnabled();
  const [connection] = await db().select({
    id: siteConnections.id,
    status: siteConnections.status,
    connectorType: siteConnections.connectorType,
    encryptedSessionState: siteConnections.encryptedSessionState,
  }).from(siteConnections).where(and(
    eq(siteConnections.id, input.body.connectionId),
    eq(siteConnections.organizationId, input.organizationId),
  )).limit(1);
  if (!connection || connection.status !== "verified") {
    throw new ApiError(409, "SITE_CONNECTION_UNAVAILABLE", "الاتصال غير موثق أو غير متاح.");
  }
  if (connection.connectorType !== "browser" || !connection.encryptedSessionState) {
    throw new ApiError(422, "BROWSER_CONNECTION_REQUIRED", "اختر اتصال جلسة متصفح موثقًا.");
  }
  const [assignment] = await db().select({ id: agentSiteConnections.id }).from(agentSiteConnections)
    .innerJoin(agents, and(
      eq(agents.id, agentSiteConnections.agentId),
      eq(agents.organizationId, input.organizationId),
    ))
    .where(and(
      eq(agentSiteConnections.organizationId, input.organizationId),
      eq(agentSiteConnections.agentId, input.body.agentId),
      eq(agentSiteConnections.siteConnectionId, connection.id),
      eq(agentSiteConnections.enabled, true),
    )).limit(1);
  if (!assignment) throw new ApiError(403, "AGENT_CONNECTION_FORBIDDEN", "الوكيل غير مرتبط بهذا الاتصال.");

  const [existing] = await db().select(publicTaskFields).from(browserTasksRuntime).where(and(
    eq(browserTasksRuntime.organizationId, input.organizationId),
    eq(browserTasksRuntime.idempotencyKey, input.body.idempotencyKey),
  )).limit(1);
  if (existing) return existing;

  const id = crypto.randomUUID();
  const [created] = await db().insert(browserTasksRuntime).values({
    id,
    organizationId: input.organizationId,
    userId: input.userId,
    agentId: input.body.agentId,
    siteConnectionId: connection.id,
    instruction: input.body.instruction,
    status: "queued",
    riskLevel: "low",
    currentStep: 0,
    idempotencyKey: input.body.idempotencyKey,
    expiresAt: new Date(Date.now() + env().browserTaskTimeoutMs + 30 * 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning(publicTaskFields);
  if (!created) throw new Error("BROWSER_TASK_CREATE_FAILED");
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.userId,
    action: "browser_task.queued",
    resourceType: "browser_task",
    resourceId: id,
    metadata: {
      agentId: input.body.agentId,
      connectionId: connection.id,
      requestId: input.requestId,
    },
  });
  const queued = await enqueueBrowserTask({ organizationId: input.organizationId, browserTaskId: id });
  return { ...created, executeJobId: queued.jobId };
}

export async function listBrowserTasks(input: {
  organizationId: string;
  userId: string;
  role: string;
  status?: string;
  limit?: number;
}) {
  assertBrowserAgentEnabled();
  const statuses = input.status?.split(",").filter((value): value is typeof browserTasksRuntime.$inferSelect.status => [
    "queued", "planning", "awaiting_connection", "running", "awaiting_approval",
    "completed", "failed", "cancelled", "expired",
  ].includes(value)) ?? [];
  return db().select({
    ...publicTaskFields,
    agentName: agents.name,
    connectionName: siteConnections.name,
    siteDomain: siteConnections.siteDomain,
  }).from(browserTasksRuntime)
    .innerJoin(agents, and(eq(agents.id, browserTasksRuntime.agentId), eq(agents.organizationId, input.organizationId)))
    .innerJoin(siteConnections, and(
      eq(siteConnections.id, browserTasksRuntime.siteConnectionId),
      eq(siteConnections.organizationId, input.organizationId),
    ))
    .where(and(
      eq(browserTasksRuntime.organizationId, input.organizationId),
      input.role === "member" ? eq(browserTasksRuntime.userId, input.userId) : undefined,
      statuses.length ? inArray(browserTasksRuntime.status, statuses) : undefined,
    )).orderBy(desc(browserTasksRuntime.createdAt)).limit(Math.min(200, Math.max(1, input.limit ?? 50)));
}

export async function getBrowserTask(input: {
  organizationId: string;
  userId: string;
  role: string;
  browserTaskId: string;
}) {
  assertBrowserAgentEnabled();
  const [task] = await db().select(publicTaskFields).from(browserTasksRuntime).where(and(
    eq(browserTasksRuntime.id, input.browserTaskId),
    eq(browserTasksRuntime.organizationId, input.organizationId),
    input.role === "member" ? eq(browserTasksRuntime.userId, input.userId) : undefined,
  )).limit(1);
  if (!task) throw new ApiError(404, "BROWSER_TASK_NOT_FOUND", "مهمة المتصفح غير موجودة.");
  const steps = await db().select().from(browserTaskSteps).where(and(
    eq(browserTaskSteps.organizationId, input.organizationId),
    eq(browserTaskSteps.browserTaskId, task.id),
  )).orderBy(browserTaskSteps.sequence);
  return { ...task, steps };
}

export async function cancelBrowserTask(input: {
  organizationId: string;
  userId: string;
  role: string;
  browserTaskId: string;
  requestId: string;
}) {
  assertBrowserAgentEnabled();
  const [task] = await db().select().from(browserTasksRuntime).where(and(
    eq(browserTasksRuntime.id, input.browserTaskId),
    eq(browserTasksRuntime.organizationId, input.organizationId),
    input.role === "member" ? eq(browserTasksRuntime.userId, input.userId) : undefined,
  )).limit(1);
  if (!task) throw new ApiError(404, "BROWSER_TASK_NOT_FOUND", "مهمة المتصفح غير موجودة.");
  if (["completed", "failed", "cancelled", "expired"].includes(task.status)) {
    return { cancelled: false, status: task.status };
  }
  const now = new Date();
  await db().transaction(async (tx) => {
    await tx.update(browserTasksRuntime).set({
      status: "cancelled",
      cancelRequestedAt: now,
      cancelledAt: now,
      completedAt: now,
      updatedAt: now,
    }).where(and(eq(browserTasksRuntime.id, task.id), eq(browserTasksRuntime.organizationId, input.organizationId)));
    await tx.update(browserTaskSteps).set({ status: "cancelled", completedAt: now }).where(and(
      eq(browserTaskSteps.organizationId, input.organizationId),
      eq(browserTaskSteps.browserTaskId, task.id),
      inArray(browserTaskSteps.status, ["queued", "running", "awaiting_approval"]),
    ));
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      action: "browser_task.cancelled",
      resourceType: "browser_task",
      resourceId: task.id,
      metadata: { previousStatus: task.status, requestId: input.requestId },
    });
  });
  if (task.externalTaskId) {
    await cancelBrowserRunnerTask({ tenantId: input.organizationId, taskId: task.externalTaskId }).catch(() => undefined);
  }
  return { cancelled: true, status: "cancelled" as const };
}
