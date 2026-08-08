import { and, count, desc, eq, gte, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { agents, conversations, integrations, mcpServers, providerCredentials, runs } from "@/db/schema";
import type { Role } from "@/lib/auth/permissions";
import { conversationAccessFilter } from "@/lib/chat/access";

export type DashboardSummarySession = {
  organizationId: string;
  userId: string;
  role: Role;
};

export async function loadDashboardSummary(session: DashboardSummarySession) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const memberRunFilter = conversationAccessFilter({ role: session.role, userId: session.userId, access: "read" });
  const isMember = session.role === "member";

  const runBase = () => db().select({ value: count() }).from(runs);
  const runCountWhere = (extra?: ReturnType<typeof eq> | ReturnType<typeof and>) => isMember
    ? runBase().innerJoin(conversations, eq(conversations.id, runs.conversationId)).where(and(
        eq(runs.organizationId, session.organizationId),
        memberRunFilter,
        extra,
      ))
    : runBase().where(and(eq(runs.organizationId, session.organizationId), extra));

  const [publishedAgents, runsToday, failedRuns, failedIntegrations, unhealthyProviders, unhealthyMcp, recentConversations, recentRuns] = await Promise.all([
    db().select({ value: count() }).from(agents).where(and(
      eq(agents.organizationId, session.organizationId),
      eq(agents.status, "published"),
    )),
    runCountWhere(gte(runs.createdAt, today)),
    runCountWhere(and(gte(runs.createdAt, today), eq(runs.status, "failed"))),
    db().select({ value: count() }).from(integrations).where(and(
      eq(integrations.organizationId, session.organizationId),
      or(eq(integrations.enabled, false), ne(integrations.status, "verified")),
    )),
    db().select({ value: count() }).from(providerCredentials).where(and(
      eq(providerCredentials.organizationId, session.organizationId),
      or(eq(providerCredentials.enabled, false), ne(providerCredentials.validationStatus, "verified"), ne(providerCredentials.healthStatus, "healthy")),
      isNull(providerCredentials.deletedAt),
    )),
    db().select({ value: count() }).from(mcpServers).where(and(
      eq(mcpServers.organizationId, session.organizationId),
      or(eq(mcpServers.enabled, false), ne(mcpServers.status, "connected")),
    )),
    db().select({
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
      .limit(6),
    isMember
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
          .orderBy(desc(runs.createdAt)).limit(5),
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
