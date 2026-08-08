import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { mcpPrompts, mcpResources, mcpResourceTemplates } from "@/db/mcp-catalog-schema";
import { mcpServers, mcpTools } from "@/db/schema";
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
      id: mcpTools.id,
      serverId: mcpTools.serverId,
      name: mcpTools.name,
      title: mcpTools.title,
      description: mcpTools.description,
      enabled: mcpTools.enabled,
      risk: mcpTools.risk,
      capability: mcpTools.capability,
      mediaType: mcpTools.mediaType,
      inputSchema: mcpTools.inputSchema,
      outputSchema: mcpTools.outputSchema,
      annotations: mcpTools.annotations,
      updatedAt: mcpTools.updatedAt,
    }).from(mcpTools).where(eq(mcpTools.organizationId, input.organizationId)).orderBy(asc(mcpTools.name)),
    db().select({
      id: mcpResources.id,
      serverId: mcpResources.serverId,
      uri: mcpResources.uri,
      name: mcpResources.name,
      title: mcpResources.title,
      description: mcpResources.description,
      mimeType: mcpResources.mimeType,
      sizeBytes: mcpResources.sizeBytes,
      enabled: mcpResources.enabled,
      updatedAt: mcpResources.updatedAt,
    }).from(mcpResources).where(eq(mcpResources.organizationId, input.organizationId)).orderBy(asc(mcpResources.name)),
    db().select({
      id: mcpResourceTemplates.id,
      serverId: mcpResourceTemplates.serverId,
      uriTemplate: mcpResourceTemplates.uriTemplate,
      name: mcpResourceTemplates.name,
      title: mcpResourceTemplates.title,
      description: mcpResourceTemplates.description,
      mimeType: mcpResourceTemplates.mimeType,
      enabled: mcpResourceTemplates.enabled,
      updatedAt: mcpResourceTemplates.updatedAt,
    }).from(mcpResourceTemplates).where(eq(mcpResourceTemplates.organizationId, input.organizationId)).orderBy(asc(mcpResourceTemplates.name)),
    db().select({
      id: mcpPrompts.id,
      serverId: mcpPrompts.serverId,
      name: mcpPrompts.name,
      title: mcpPrompts.title,
      description: mcpPrompts.description,
      arguments: mcpPrompts.arguments,
      enabled: mcpPrompts.enabled,
      updatedAt: mcpPrompts.updatedAt,
    }).from(mcpPrompts).where(eq(mcpPrompts.organizationId, input.organizationId)).orderBy(asc(mcpPrompts.name)),
  ]);

  return servers.map((server) => ({
    ...server,
    tools: tools
      .filter((item) => item.serverId === server.id)
      .map((tool) => ({ ...tool, approvalMode: "حسب ربط الوكيل" })),
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
    healthyServerCount: servers.filter((server) => server.enabled && server.status === "connected" && !server.lastError).length,
    degradedServerCount: servers.filter((server) => server.enabled && server.status === "connected" && Boolean(server.lastError)).length,
    toolCount: servers.reduce((sum, server) => sum + server.tools.filter((tool) => tool.enabled).length, 0),
    resourceCount: servers.reduce((sum, server) => sum + server.resources.filter((resource) => resource.enabled).length, 0),
    resourceTemplateCount: servers.reduce((sum, server) => sum + server.resourceTemplates.filter((template) => template.enabled).length, 0),
    promptCount: servers.reduce((sum, server) => sum + server.prompts.filter((prompt) => prompt.enabled).length, 0),
    servers,
  };
}
