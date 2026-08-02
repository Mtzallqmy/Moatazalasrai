import { and, count, desc, eq, gte, inArray, sql, sum } from "drizzle-orm";
import { db, checkDatabase } from "@/db";
import { toolApprovalsRuntime } from "@/db/agent-runtime-schema";
import { browserTasksRuntime } from "@/db/browser-runtime-schema";
import { sandboxExecutions, sandboxWorkspaces } from "@/db/sandbox-schema";
import { siteConnections } from "@/db/site-connections-schema";
import {
  agents,
  auditLogs,
  conversations,
  organizationMembers,
  runs,
} from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { env } from "@/lib/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("runs:read");
    const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get("days") ?? 30)));
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const previousSince = new Date(since.getTime() - days * 24 * 60 * 60_000);
    const organizationId = session.organizationId;
    const memberScoped = session.role === "member" ? session.userId : null;

    const [
      agentRows,
      conversationRows,
      runRows,
      previousRunRows,
      sandboxRows,
      connectionRows,
      approvalRows,
      memberRows,
      recentErrors,
      recentActivity,
      databaseState,
    ] = await Promise.all([
      db().select({ status: agents.status, value: count() }).from(agents)
        .where(eq(agents.organizationId, organizationId)).groupBy(agents.status),
      db().select({ value: count() }).from(conversations).where(and(
        eq(conversations.organizationId, organizationId),
        memberScoped ? eq(conversations.createdByUserId, memberScoped) : undefined,
        gte(conversations.createdAt, since),
      )),
      db().select({
        status: runs.status,
        value: count(),
        inputTokens: sum(runs.inputTokens),
        outputTokens: sum(runs.outputTokens),
      }).from(runs).where(and(eq(runs.organizationId, organizationId), gte(runs.createdAt, since))).groupBy(runs.status),
      db().select({ value: count() }).from(runs).where(and(
        eq(runs.organizationId, organizationId),
        gte(runs.createdAt, previousSince),
        sql`${runs.createdAt} < ${since}`,
      )),
      Promise.all([
        db().select({ value: count() }).from(sandboxWorkspaces).where(and(
          eq(sandboxWorkspaces.organizationId, organizationId),
          inArray(sandboxWorkspaces.status, ["provisioning", "ready", "resetting"]),
        )),
        db().select({ value: count() }).from(sandboxExecutions).where(and(
          eq(sandboxExecutions.organizationId, organizationId),
          inArray(sandboxExecutions.status, ["queued", "awaiting_approval", "running"]),
        )),
        db().select({ value: count() }).from(browserTasksRuntime).where(and(
          eq(browserTasksRuntime.organizationId, organizationId),
          inArray(browserTasksRuntime.status, ["queued", "planning", "running", "awaiting_approval", "awaiting_connection"]),
        )),
      ]),
      db().select({ status: siteConnections.status, value: count() }).from(siteConnections)
        .where(eq(siteConnections.organizationId, organizationId)).groupBy(siteConnections.status),
      db().select({ value: count() }).from(toolApprovalsRuntime).where(and(
        eq(toolApprovalsRuntime.organizationId, organizationId),
        eq(toolApprovalsRuntime.status, "pending"),
        gte(toolApprovalsRuntime.expiresAt, new Date()),
      )),
      db().select({ value: count() }).from(organizationMembers).where(eq(organizationMembers.organizationId, organizationId)),
      db().select({
        id: auditLogs.id,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
      }).from(auditLogs).where(and(
        eq(auditLogs.organizationId, organizationId),
        sql`(${auditLogs.action} LIKE '%failed%' OR ${auditLogs.action} LIKE '%denied%' OR ${auditLogs.action} LIKE '%error%')`,
      )).orderBy(desc(auditLogs.createdAt)).limit(8),
      db().select({
        id: auditLogs.id,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        actorType: auditLogs.actorType,
        createdAt: auditLogs.createdAt,
      }).from(auditLogs).where(eq(auditLogs.organizationId, organizationId)).orderBy(desc(auditLogs.createdAt)).limit(12),
      checkDatabase(),
    ]);

    const agentCounts = Object.fromEntries(agentRows.map((row) => [row.status, numberValue(row.value)]));
    const runCounts = Object.fromEntries(runRows.map((row) => [row.status, numberValue(row.value)]));
    const runTotal = Object.values(runCounts).reduce((total, value) => total + value, 0);
    const previousRunTotal = numberValue(previousRunRows[0]?.value);
    const inputTokens = runRows.reduce((total, row) => total + numberValue(row.inputTokens), 0);
    const outputTokens = runRows.reduce((total, row) => total + numberValue(row.outputTokens), 0);
    const connectionCounts = Object.fromEntries(connectionRows.map((row) => [row.status, numberValue(row.value)]));
    const config = env();

    return apiSuccess({
      period: { days, since: since.toISOString(), comparisonRunsPercent: previousRunTotal ? Math.round(((runTotal - previousRunTotal) / previousRunTotal) * 100) : null },
      agents: { total: Object.values(agentCounts).reduce((total, value) => total + value, 0), published: agentCounts.published ?? 0, draft: agentCounts.draft ?? 0, archived: agentCounts.archived ?? 0 },
      conversations: numberValue(conversationRows[0]?.value),
      runs: { total: runTotal, completed: runCounts.completed ?? 0, failed: runCounts.failed ?? 0, cancelled: runCounts.cancelled ?? 0, inputTokens, outputTokens },
      sandbox: { enabled: config.sandboxEnabled, activeWorkspaces: numberValue(sandboxRows[0][0]?.value), activeExecutions: numberValue(sandboxRows[1][0]?.value) },
      browser: { enabled: config.browserAgentEnabled, activeTasks: numberValue(sandboxRows[2][0]?.value) },
      connections: { total: Object.values(connectionCounts).reduce((total, value) => total + value, 0), verified: connectionCounts.verified ?? 0, failed: connectionCounts.failed ?? 0 },
      approvalsPending: numberValue(approvalRows[0]?.value),
      members: numberValue(memberRows[0]?.value),
      recentErrors,
      recentActivity,
      health: {
        database: "ready",
        databaseLatencyMs: databaseState.latencyMs,
        workerActive: databaseState.worker.active,
        workerLastSeenAt: databaseState.worker.lastSeenAt,
        storageDriver: process.env.OBJECT_STORAGE_DRIVER?.trim() || "local",
      },
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/operations-overview");
  }
}
