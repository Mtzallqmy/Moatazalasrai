import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { mcpPrompts, mcpResources, mcpResourceTemplates, mcpServers, mcpTools } from "@/db/schema";
import { assertUserPermission } from "@/lib/auth/user-authorization";
import { ApiError } from "@/lib/http/api";

export async function listOrganizationMcpCatalog(input: {
  organizationId: string;
  userId: string;
}) {
  await assertUserPermission({ ...input, permission: "integrations:read" });
  const [servers, tools, resources, resourceTemplates, prompts] = await Promise.all([
    db().select({
      id: mcpServers.id,
      name: mcpServers.name,
      url: mcpServers.url,
      authType: mcpServers.authType,
      enabled: mcpServers.enabled,
      lastConnectedAt: mcpServers.lastConnectedAt,
      lastError: mcpServers.lastError,
      createdAt: mcpServers.createdAt,
      updatedAt: mcpServers.updatedAt,
    }).from(mcpServers).where(eq(mcpServers.organizationId, input.organizationId)).orderBy(desc(mcpServers.updatedAt)),
    db().select({
      serverId: mcpTools.serverId,
      name: mcpTools.name,
      description: mcpTools.description,
      enabled: mcpTools.enabled,
      approvalMode: mcpTools.approvalMode,
      risk: mcpTools.risk,
      timeoutMs: mcpTools.timeoutMs,
      maxPayloadBytes: mcpTools.maxPayloadBytes,
      lastSeenAt: mcpTools.lastSeenAt,
    }).from(mcpTools).where(eq(mcpTools.organizationId, input.organizationId)).orderBy(asc(mcpTools.name)),
    db().select({
      serverId: mcpResources.serverId,
      uri: mcpResources.uri,
      name: mcpResources.name,
      description: mcpResources.description,
      mimeType: mcpResources.mimeType,
      enabled: mcpResources.enabled,
      lastSeenAt: mcpResources.lastSeenAt,
    }).from(mcpResources).where(eq(mcpResources.organizationId, input.organizationId)).orderBy(asc(mcpResources.name)),
    db().select({
      serverId: mcpResourceTemplates.serverId,
      uriTemplate: mcpResourceTemplates.uriTemplate,
      name: mcpResourceTemplates.name,
      description: mcpResourceTemplates.description,
      mimeType: mcpResourceTemplates.mimeType,
      enabled: mcpResourceTemplates.enabled,
      lastSeenAt: mcpResourceTemplates.lastSeenAt,
    }).from(mcpResourceTemplates).where(eq(mcpResourceTemplates.organizationId, input.organizationId)).orderBy(asc(mcpResourceTemplates.name)),
    db().select({
      serverId: mcpPrompts.serverId,
      name: mcpPrompts.name,
      description: mcpPrompts.description,
      enabled: mcpPrompts.enabled,
      lastSeenAt: mcpPrompts.lastSeenAt,
    }).from(mcpPrompts).where(eq(mcpPrompts.organizationId, input.organizationId)).orderBy(asc(mcpPrompts.name)),
  ]);
  return servers.map((server) => ({
    ...server,
    tools: tools.filter((item) => item.serverId === server.id),
    resources: resources.filter((item) => item.serverId === server.id),
    resourceTemplates: resourceTemplates.filter((item) => item.serverId === server.id),
    prompts: prompts.filter((item) => item.serverId === server.id),
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
    healthyServerCount: servers.filter((server) => server.enabled && server.lastConnectedAt && !server.lastError).length,
    toolCount: servers.reduce((sum, server) => sum + server.tools.filter((tool) => tool.enabled).length, 0),
    resourceCount: servers.reduce((sum, server) => sum + server.resources.filter((resource) => resource.enabled).length, 0),
    promptCount: servers.reduce((sum, server) => sum + server.prompts.filter((prompt) => prompt.enabled).length, 0),
    servers,
  };
}
