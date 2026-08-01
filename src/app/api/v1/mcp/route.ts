import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { mcpServers, mcpTools } from "@/db/schema";
import { mcpPrompts, mcpResources, mcpResourceTemplates } from "@/db/mcp-catalog-schema";
import {
  executeMcpTool,
  readMcpResource,
  renderMcpPrompt,
  syncMcpServer,
} from "@/ai/mcp/service";
import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { apiFailure, apiSuccess, ApiError, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { encryptSecret, maskSecret } from "@/lib/security/encryption";
import { validateProviderBaseUrl } from "@/lib/security/provider-network";

const stringArguments = z.record(z.string().trim().min(1).max(100), z.string().max(20_000))
  .refine((value) => Object.keys(value).length <= 40, "Too many prompt arguments.");

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(2).max(100),
    endpoint: z.string().url().max(2048),
    bearerToken: z.string().trim().min(8).max(4000).optional(),
  }).strict(),
  z.object({ action: z.literal("sync"), serverId: z.string().uuid() }).strict(),
  z.object({
    action: z.literal("call"),
    toolId: z.string().uuid(),
    arguments: z.record(z.string(), z.unknown()).default({}),
  }).strict(),
  z.object({
    action: z.literal("read_resource"),
    serverId: z.string().uuid(),
    uri: z.string().trim().min(1).max(4096),
  }).strict(),
  z.object({
    action: z.literal("get_prompt"),
    serverId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    arguments: stringArguments.default({}),
  }).strict(),
]);

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "رمز الوصول غير صالح.", requestId);
    requireApiScope(principal, "mcp:read");
    const [servers, tools, resources, resourceTemplates, prompts] = await Promise.all([
      db().select({
        id: mcpServers.id,
        name: mcpServers.name,
        endpoint: mcpServers.endpoint,
        authMode: mcpServers.authMode,
        tokenHint: mcpServers.tokenHint,
        status: mcpServers.status,
        serverName: mcpServers.serverName,
        serverVersion: mcpServers.serverVersion,
        protocolVersion: mcpServers.protocolVersion,
        capabilities: mcpServers.capabilities,
        lastConnectedAt: mcpServers.lastConnectedAt,
        lastErrorCode: mcpServers.lastErrorCode,
        oauthScopes: mcpServers.oauthScopes,
        oauthExpiresAt: mcpServers.oauthExpiresAt,
        oauthConnectedAt: mcpServers.oauthConnectedAt,
        enabled: mcpServers.enabled,
      }).from(mcpServers).where(eq(mcpServers.organizationId, principal.organizationId))
        .orderBy(desc(mcpServers.updatedAt)),
      db().select({
        id: mcpTools.id,
        serverId: mcpTools.serverId,
        name: mcpTools.name,
        title: mcpTools.title,
        description: mcpTools.description,
        inputSchema: mcpTools.inputSchema,
        outputSchema: mcpTools.outputSchema,
        annotations: mcpTools.annotations,
        capability: mcpTools.capability,
        mediaType: mcpTools.mediaType,
        risk: mcpTools.risk,
        enabled: mcpTools.enabled,
      }).from(mcpTools).where(and(
        eq(mcpTools.organizationId, principal.organizationId),
        eq(mcpTools.enabled, true),
      )).orderBy(asc(mcpTools.name)),
      db().select().from(mcpResources).where(and(
        eq(mcpResources.organizationId, principal.organizationId),
        eq(mcpResources.enabled, true),
      )).orderBy(asc(mcpResources.name)),
      db().select().from(mcpResourceTemplates).where(and(
        eq(mcpResourceTemplates.organizationId, principal.organizationId),
        eq(mcpResourceTemplates.enabled, true),
      )).orderBy(asc(mcpResourceTemplates.name)),
      db().select().from(mcpPrompts).where(and(
        eq(mcpPrompts.organizationId, principal.organizationId),
        eq(mcpPrompts.enabled, true),
      )).orderBy(asc(mcpPrompts.name)),
    ]);
    return apiSuccess({ servers, tools, resources, resourceTemplates, prompts }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/mcp");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "رمز الوصول غير صالح.", requestId);
    const body = await parseJson(request, actionSchema, 64 * 1024);
    if (body.action === "read_resource") {
      requireApiScope(principal, "mcp:read");
      const result = await readMcpResource({
        organizationId: principal.organizationId,
        serverId: body.serverId,
        uri: body.uri,
        userId: principal.userId,
      });
      return apiSuccess({ serverId: body.serverId, uri: body.uri, result }, requestId);
    }
    if (body.action === "get_prompt") {
      requireApiScope(principal, "mcp:read");
      const result = await renderMcpPrompt({
        organizationId: principal.organizationId,
        serverId: body.serverId,
        name: body.name,
        arguments: body.arguments,
        userId: principal.userId,
      });
      return apiSuccess({ serverId: body.serverId, name: body.name, result }, requestId);
    }

    requireApiScope(principal, "mcp:write");
    if (body.action === "create") {
      const endpoint = (await validateProviderBaseUrl(body.endpoint)).normalizedUrl;
      const [created] = await db().insert(mcpServers).values({
        organizationId: principal.organizationId,
        name: body.name,
        endpoint,
        encryptedBearerToken: body.bearerToken ? encryptSecret(body.bearerToken, `mcp:${principal.organizationId}`) : null,
        tokenHint: body.bearerToken ? maskSecret(body.bearerToken) : null,
      }).returning({ id: mcpServers.id });
      if (!created) throw new Error("MCP_SERVER_CREATE_FAILED");
      const discovery = await syncMcpServer(principal.organizationId, created.id);
      return apiSuccess({
        serverId: created.id,
        counts: {
          tools: discovery.tools.length,
          resources: discovery.resources.length,
          resourceTemplates: discovery.resourceTemplates.length,
          prompts: discovery.prompts.length,
        },
        discoveryErrors: discovery.discoveryErrors,
      }, requestId, 201);
    }
    if (body.action === "sync") {
      const discovery = await syncMcpServer(principal.organizationId, body.serverId);
      return apiSuccess({
        serverId: body.serverId,
        counts: {
          tools: discovery.tools.length,
          resources: discovery.resources.length,
          resourceTemplates: discovery.resourceTemplates.length,
          prompts: discovery.prompts.length,
        },
        discoveryErrors: discovery.discoveryErrors,
      }, requestId);
    }
    const result = await executeMcpTool({
      organizationId: principal.organizationId,
      toolId: body.toolId,
      arguments: body.arguments,
      userId: principal.userId ?? undefined,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/mcp");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "رمز الوصول غير صالح.", requestId);
    requireApiScope(principal, "mcp:write");
    const serverId = new URL(request.url).searchParams.get("serverId");
    if (!serverId || !z.string().uuid().safeParse(serverId).success) {
      throw new ApiError(400, "MCP_SERVER_ID_REQUIRED", "معرّف خادم MCP مطلوب.");
    }
    const [deleted] = await db().delete(mcpServers).where(and(
      eq(mcpServers.id, serverId),
      eq(mcpServers.organizationId, principal.organizationId),
    )).returning({ id: mcpServers.id });
    if (!deleted) throw new ApiError(404, "MCP_SERVER_NOT_FOUND", "خادم MCP غير موجود.");
    return apiSuccess({ deleted: true, id: deleted.id }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/mcp");
  }
}
