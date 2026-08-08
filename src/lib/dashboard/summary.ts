import { and, count, desc, eq, gte, isNull, ne, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { agents, conversations, integrations, mcpServers, providerCredentials, runs } from "@/db/schema";
import { can, type Permission, type Role } from "@/lib/auth/permissions";
import { conversationAccessFilter } from "@/lib/chat/access";

export type DashboardSummarySession = {
  organizationId: string;
  userId: string;
  role: Role;
  permissions?: Permission[];
};

export async function loadDashboardSummary(session: DashboardSummarySession) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const allowed = (permission: Permission) => can(session.role, permission) || Boolean(session.permissions?.includes(permission));
  const canReadAgents = allowed("agents:read");
  const canRunAgents = allowed("agents:run");
  const canReadRuns = allowed("runs:read");
  const canReadIntegrations = allowed("integrations:read");
  const canReadProviders = allowed("providers:read");
  const canReadMcp = allowed("providers:manage");
  const memberRunFilter = conversationAccessFilter({ role: session.role, userId: session.userId, access: "read" });
  const isMember = session.role === "member";
  const zeroCount = Promise.resolve([{ value: 0 }]);

  const runBase = () => db().select({ value: count() }).from(runs);
  const runCountWhere = (extra?: SQL) => isMember
    ? runBase().innerJoin(conversations, eq(conversations.id, runs.conversationId)).where(and(
        eq(runs.organizationId, session.organizationId),
        memberRunFilter,
        extra,
      ))
    : runBase().where(and(eq(runs.organizationId, session.organizationId), extra));

  const [publishedAgents, runsToday, failedRuns, failedIntegrations, unhealthyProviders, unhealthyMcp, recentConversations, recentRuns] = await Promise.all([
    canReadAgents
      ? db().select({ value: count() }).from(agents).where(and(
          eq(agents.organizationId, session.organizationId),
          eq(agents.status, "published"),
        ))
      : zeroCount,
    canReadRuns ? runCountWhere(gte(runs.createdAt, today)) : zeroCount,
    canReadRuns ? runCountWhere(and(gte(runs.createdAt, today), eq(runs.status, "failed"))) : zeroCount,
    canReadIntegrations
      ? db().select({ value: count() }).from(integrations).where(and(
          eq(integrations.organizationId, session.organizationId),
          eq(integrations.enabled, true),
          ne(integrations.status, "verified"),
        ))
      : zeroCount,
    canReadProviders
      ? db().select({ value: count() }).from(providerCredentials).where(and(
          eq(providerCredentials.organizationId, session.organizationId),
          eq(providerCredentials.enabled, true),
          isNull(providerCredentials.deletedAt),
          or(ne(providerCredentials.validationStatus, "verified"), ne(providerCredentials.healthStatus, "healthy")),
        ))
      : zeroCount,
    canReadMcp
      ? db().select({ value: count() }).from(mcpServers).where(and(
          eq(mcpServers.organizationId, session.organizationId),
          eq(mcpServers.enabled, true),
          ne(mcpServers.status, "connected"),
        ))
      : zeroCount,
    canRunAgents
      ? db().select({
          id: conversations.id,
          title: conversations.title,
          summary: conversations.summary,
          agentName: agents.name,
          updatedAt: conversations.updatedAt,
          lastMessageAt: conversations.lastMessageAt,
          pinnedAt: conversations.pinnedAt,
        }).from(conversations)
          .innerJoin(agents, eq(agents.id, conversations.agentId))
          .where(and(
            eq(conversations.organizationId, session.organizationId),
            conversationAccessFilter({ role: session.role, userId: session.userId, access: "read" }),
            isNull(conversations.deletedAt),
            isNull(conversations.archivedAt),
          ))
          .orderBy(desc(conversations.pinnedAt), desc(conversations.lastMessageAt), desc(conversations.updatedAt))
          .limit(6)
      : Promise.resolve([]),
    canReadRuns
      ? isMember
        ? db().select({
            id: runs.id,
            status: runs.status,
            model: runs.model,
            createdAt: runs.createdAt,
            agentName: agents.name,
            conversationId: runs.conversationId,
          }).from(runs)
            .innerJoin(agents, eq(agents.id, runs.agentId))
            .innerJoin(conversations, eq(conversations.id, runs.conversationId))
            .where(and(eq(runs.organizationId, session.organizationId), memberRunFilter))
            .orderBy(desc(runs.createdAt)).limit(5)
        : db().select({
            id: runs.id,
            status: runs.status,
            model: runs.model,
            createdAt: runs.createdAt,
            agentName: agents.name,
            conversationId: runs.conversationId,
          }).from(runs)
            .innerJoin(agents, eq(agents.id, runs.agentId))
            .where(eq(runs.organizationId, session.organizationId))
            .orderBy(desc(runs.createdAt)).limit(5)
      : Promise.resolve([]),
  ]);

  return {
    activeAgents: publishedAgents[0]?.value ?? 0,
    runsToday: runsToday[0]?.value ?? 0,
    failedRuns: failedRuns[0]?.value ?? 0,
    integrationsNeedingAttention: (failedIntegrations[0]?.value ?? 0) + (unhealthyProviders[0]?.value ?? 0) + (unhealthyMcp[0]?.value ?? 0),
    recentConversations,
    recentRuns,
  };
}
