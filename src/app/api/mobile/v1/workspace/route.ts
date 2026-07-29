import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  mcpServers,
  mcpTools,
  organizationMembers,
  organizations,
  users,
} from "@/db/schema";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";

const administrativeRoles = new Set(["owner", "admin"]);

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal?.userId || principal.kind !== "mobile_session") {
      return apiFailure(401, "UNAUTHORIZED", "جلسة التطبيق غير صالحة.", requestId);
    }
    const canAdminister = administrativeRoles.has(principal.role ?? "");
    const [organization, servers, tools, members, audit] = await Promise.all([
      db().select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        defaultModel: organizations.defaultModel,
        updatedAt: organizations.updatedAt,
      }).from(organizations).where(eq(organizations.id, principal.organizationId)).limit(1),
      principal.scopes.includes("mcp:read")
        ? db().select({
          id: mcpServers.id,
          name: mcpServers.name,
          endpoint: mcpServers.endpoint,
          status: mcpServers.status,
          enabled: mcpServers.enabled,
          serverName: mcpServers.serverName,
          serverVersion: mcpServers.serverVersion,
          protocolVersion: mcpServers.protocolVersion,
          lastConnectedAt: mcpServers.lastConnectedAt,
          lastErrorCode: mcpServers.lastErrorCode,
        }).from(mcpServers).where(eq(mcpServers.organizationId, principal.organizationId))
          .orderBy(desc(mcpServers.updatedAt))
        : Promise.resolve([]),
      principal.scopes.includes("mcp:read")
        ? db().select({
          id: mcpTools.id,
          serverId: mcpTools.serverId,
          name: mcpTools.name,
          title: mcpTools.title,
          description: mcpTools.description,
          risk: mcpTools.risk,
          enabled: mcpTools.enabled,
        }).from(mcpTools).where(and(
          eq(mcpTools.organizationId, principal.organizationId),
          eq(mcpTools.enabled, true),
        )).orderBy(asc(mcpTools.name))
        : Promise.resolve([]),
      canAdminister
        ? db().select({
          id: organizationMembers.id,
          userId: users.id,
          name: users.name,
          email: users.email,
          role: organizationMembers.role,
          createdAt: organizationMembers.createdAt,
        }).from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .where(eq(organizationMembers.organizationId, principal.organizationId))
          .orderBy(asc(organizationMembers.createdAt))
        : Promise.resolve([]),
      canAdminister
        ? db().select({
          id: auditLogs.id,
          actorType: auditLogs.actorType,
          action: auditLogs.action,
          resourceType: auditLogs.resourceType,
          resourceId: auditLogs.resourceId,
          createdAt: auditLogs.createdAt,
        }).from(auditLogs)
          .where(eq(auditLogs.organizationId, principal.organizationId))
          .orderBy(desc(auditLogs.createdAt))
          .limit(100)
        : Promise.resolve([]),
    ]);
    return apiSuccess({
      organization: organization[0] ?? null,
      capabilities: {
        canManage: canAdminister,
        canWriteProviders: principal.scopes.includes("providers:write"),
        canWriteMcp: principal.scopes.includes("mcp:write"),
        canWriteAgents: principal.scopes.includes("agents:write"),
        canWriteTeams: principal.scopes.includes("teams:write"),
      },
      mcp: { servers, tools },
      members,
      audit,
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/mobile/v1/workspace");
  }
}
