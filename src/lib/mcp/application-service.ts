import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { mcpServers, mcpTools } from "@/db/schema";
import { assertUserPermission } from "@/lib/auth/user-authorization";
import { ApiError } from "@/lib/http/api";

export async function listOrganizationMcpCatalog(input: {
  organizationId: string;
  userId: string;
}) {
  await assertUserPermission({ ...input, permission: "integrations:read" });
  const [servers, tools] = await Promise.all([
    db().select({
      id: mcpServers.id,
      name: mcpServers.name,
      url: mcpServers.endpoint,
      authType: mcpServers.authMode,
      transport: mcpServers.transport,
      enabled: mcpServers.enabled,
      status: mcpServers.status,
      protocolVersion: mcpServers.protocolVersion,
      serverName: mcpServers.serverName,
      serverVersion: mcpServers.serverVersion,
      capabilities: mcpServers.capabilities,
      lastConnectedAt: mcpServers.lastConnectedAt,
      lastError: mcpServers.lastErrorCode,
      createdAt: mcpServers.createdAt,
      updatedAt: mcpServers.updatedAt,
    }).from(mcpServers).where(eq(mcpServers.organizationId, input.organizationId)).orderBy(desc(mcpServers.updatedAt)),
    db().select({
      serverId: mcpTools.serverId,
      name: mcpTools.name,
      title: mcpTools.title,
      description: mcpTools.description,
      enabled: mcpTools.enabled,
      risk: mcpTools.risk,
      capability: mcpTools.capability,
      mediaType: mcpTools.mediaType,
      updatedAt: mcpTools.updatedAt,
    }).from(mcpTools).where(eq(mcpTools.organizationId, input.organizationId)).orderBy(asc(mcpTools.name)),
  ]);

  return servers.map((server) => ({
    ...server,
    tools: tools.filter((item) => item.serverId === server.id),
    // The current persisted MCP schema exposes synchronized tools only.
    // Keep these collections explicit and empty until dedicated persisted
    // resource/prompt/template tables are introduced and migrated.
    resources: [] as Array<never>,
    resourceTemplates: [] as Array<never>,
    prompts: [] as Array<never>,
  }));
}

export async function getOrganizationMcpServer(input: {
  organizationId: string;
  userId: string;
  serverId: string;
}) {
  const servers = await listOrganizationMcpCatalog(input);
  const server = servers.find((item) => item.id === input.serverId);
  if (!server) throw new ApiError(404, "MCP_SERVER_NOT_FOUND", "خادم MCP غير موجود في المؤسسة الحالية.");
  return server;
}

export async function organizationMcpSummary(input: {
  organizationId: string;
  userId: string;
}) {
  const servers = await listOrganizationMcpCatalog(input);
  return {
    serverCount: servers.length,
    enabledServerCount: servers.filter((server) => server.enabled).length,
    healthyServerCount: servers.filter((server) => server.enabled && server.status === "connected" && !server.lastError).length,
    toolCount: servers.reduce((sum, server) => sum + server.tools.filter((tool) => tool.enabled).length, 0),
    resourceCount: 0,
    promptCount: 0,
    servers,
  };
}
