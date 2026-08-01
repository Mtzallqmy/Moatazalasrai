import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { mcpServers, mcpTools } from "@/db/schema";
import { mcpPrompts, mcpResources, mcpResourceTemplates } from "@/db/mcp-catalog-schema";
import {
  createHiggsfieldServer,
  executeMcpTool,
  readMcpResource,
  renderMcpPrompt,
  startHiggsfieldOAuth,
  syncMcpServer,
} from "@/ai/mcp/service";
import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, ApiError, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { encryptSecret, maskSecret } from "@/lib/security/encryption";
import { validateProviderBaseUrl } from "@/lib/security/provider-network";

const stringArguments = z.record(z.string().trim().min(1).max(100), z.string().max(20_000))
  .refine((value) => Object.keys(value).length <= 40, "Too many prompt arguments.");

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect_higgsfield") }).strict(),
  z.object({ action: z.literal("authorize"), serverId: z.string().uuid() }).strict(),
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(2).max(100),
    endpoint: z.string().url().max(2048),
    bearerToken: z.string().trim().min(8).max(4000).optional(),
  }).strict(),
  z.object({ action: z.literal("sync"), serverId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("call"), toolId: z.string().uuid(), arguments: z.record(z.string(), z.unknown()).default({}) }).strict(),
  z.object({ action: z.literal("read_resource"), serverId: z.string().uuid(), uri: z.string().trim().min(1).max(4096) }).strict(),
  z.object({ action: z.literal("get_prompt"), serverId: z.string().uuid(), name: z.string().trim().min(1).max(200), arguments: stringArguments.default({}) }).strict(),
]);

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("integrations:read");
    const [servers, tools, resources, resourceTemplates, prompts] = await Promise.all([
      db().select({
        id: mcpServers.id, name: mcpServers.name, endpoint: mcpServers.endpoint, authMode: mcpServers.authMode,
        tokenHint: mcpServers.tokenHint, status: mcpServers.status, serverName: mcpServers.serverName,
        serverVersion: mcpServers.serverVersion, protocolVersion: mcpServers.protocolVersion,
        capabilities: mcpServers.capabilities, lastConnectedAt: mcpServers.lastConnectedAt,
        lastErrorCode: mcpServers.lastErrorCode, oauthScopes: mcpServers.oauthScopes,
        oauthExpiresAt: mcpServers.oauthExpiresAt, oauthConnectedAt: mcpServers.oauthConnectedAt,
        enabled: mcpServers.enabled,
      }).from(mcpServers).where(eq(mcpServers.organizationId, session.organizationId)).orderBy(desc(mcpServers.updatedAt)),
      db().select().from(mcpTools).where(and(eq(mcpTools.organizationId, session.organizationId), eq(mcpTools.enabled, true))).orderBy(asc(mcpTools.name)),
      db().select().from(mcpResources).where(and(eq(mcpResources.organizationId, session.organizationId), eq(mcpResources.enabled, true))).orderBy(asc(mcpResources.name)),
      db().select().from(mcpResourceTemplates).where(and(eq(mcpResourceTemplates.organizationId, session.organizationId), eq(mcpResourceTemplates.enabled, true))).orderBy(asc(mcpResourceTemplates.name)),
      db().select().from(mcpPrompts).where(and(eq(mcpPrompts.organizationId, session.organizationId), eq(mcpPrompts.enabled, true))).orderBy(asc(mcpPrompts.name)),
    ]);
    return apiSuccess({ servers, tools, resources, resourceTemplates, prompts }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/mcp");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const body = await parseJson(request, actionSchema, 64 * 1024);
    const readOnly = body.action === "read_resource" || body.action === "get_prompt";
    const session = await requireSession(readOnly ? "integrations:read" : "integrations:manage");

    if (body.action === "read_resource") {
      const result = await readMcpResource({ organizationId: session.organizationId, serverId: body.serverId, uri: body.uri, userId: session.userId });
      return apiSuccess({ serverId: body.serverId, uri: body.uri, result }, requestId);
    }
    if (body.action === "get_prompt") {
      const result = await renderMcpPrompt({ organizationId: session.organizationId, serverId: body.serverId, name: body.name, arguments: body.arguments, userId: session.userId });
      return apiSuccess({ serverId: body.serverId, name: body.name, result }, requestId);
    }
    if (body.action === "connect_higgsfield") {
      const server = await createHiggsfieldServer(session.organizationId);
      const oauth = await startHiggsfieldOAuth(session.organizationId, server.id, new URL(request.url).origin);
      if (oauth.connected) {
        const discovery = await syncMcpServer(session.organizationId, server.id, new URL(request.url).origin);
        return apiSuccess({ serverId: server.id, connected: true, counts: catalogCounts(discovery) }, requestId);
      }
      return apiSuccess({ serverId: server.id, connected: false, authorizationUrl: oauth.authorizationUrl }, requestId);
    }
    if (body.action === "authorize") {
      const oauth = await startHiggsfieldOAuth(session.organizationId, body.serverId, new URL(request.url).origin);
      if (oauth.connected) {
        const discovery = await syncMcpServer(session.organizationId, body.serverId, new URL(request.url).origin);
        return apiSuccess({ serverId: body.serverId, connected: true, counts: catalogCounts(discovery) }, requestId);
      }
      return apiSuccess({ serverId: body.serverId, connected: false, authorizationUrl: oauth.authorizationUrl }, requestId);
    }
    if (body.action === "create") {
      const endpoint = (await validateProviderBaseUrl(body.endpoint)).normalizedUrl;
      const [created] = await db().insert(mcpServers).values({
        organizationId: session.organizationId, name: body.name, endpoint,
        encryptedBearerToken: body.bearerToken ? encryptSecret(body.bearerToken, `mcp:${session.organizationId}`) : null,
        tokenHint: body.bearerToken ? maskSecret(body.bearerToken) : null,
      }).returning({ id: mcpServers.id });
      if (!created) throw new Error("MCP_SERVER_CREATE_FAILED");
      const discovery = await syncMcpServer(session.organizationId, created.id, new URL(request.url).origin);
      return apiSuccess({ serverId: created.id, counts: catalogCounts(discovery), discoveryErrors: discovery.discoveryErrors }, requestId, 201);
    }
    if (body.action === "sync") {
      const discovery = await syncMcpServer(session.organizationId, body.serverId, new URL(request.url).origin);
      return apiSuccess({ serverId: body.serverId, counts: catalogCounts(discovery), discoveryErrors: discovery.discoveryErrors }, requestId);
    }
    const result = await executeMcpTool({ organizationId: session.organizationId, toolId: body.toolId, arguments: body.arguments, userId: session.userId });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/mcp");
  }
}

function catalogCounts(discovery: Awaited<ReturnType<typeof syncMcpServer>>) {
  return {
    tools: discovery.tools.length,
    resources: discovery.resources.length,
    resourceTemplates: discovery.resourceTemplates.length,
    prompts: discovery.prompts.length,
  };
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("integrations:manage");
    const serverId = new URL(request.url).searchParams.get("serverId");
    if (!serverId || !z.string().uuid().safeParse(serverId).success) throw new ApiError(400, "MCP_SERVER_ID_REQUIRED", "معرّف خادم MCP مطلوب.");
    const [deleted] = await db().delete(mcpServers).where(and(eq(mcpServers.id, serverId), eq(mcpServers.organizationId, session.organizationId))).returning({ id: mcpServers.id });
    if (!deleted) throw new ApiError(404, "MCP_SERVER_NOT_FOUND", "خادم MCP غير موجود.");
    return apiSuccess({ deleted: true, id: deleted.id }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/mcp");
  }
}
