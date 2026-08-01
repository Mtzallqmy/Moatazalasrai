import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, mcpServers, mcpTools } from "@/db/schema";
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

const updateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_server"),
    serverId: z.string().uuid(),
    name: z.string().trim().min(2).max(100).optional(),
    enabled: z.boolean().optional(),
    bearerToken: z.union([z.string().trim().min(8).max(4000), z.null()]).optional(),
  }).strict().refine((value) => value.name !== undefined || value.enabled !== undefined || value.bearerToken !== undefined, {
    message: "No server changes supplied.",
  }),
  z.object({
    action: z.literal("set_catalog_enabled"),
    kind: z.enum(["tool", "resource", "resource_template", "prompt"]),
    id: z.string().uuid(),
    enabled: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("set_tool_policy"),
    id: z.string().uuid(),
    risk: z.enum(["low", "medium", "high"]),
  }).strict(),
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
      db().select().from(mcpTools).where(eq(mcpTools.organizationId, session.organizationId)).orderBy(asc(mcpTools.name)),
      db().select().from(mcpResources).where(eq(mcpResources.organizationId, session.organizationId)).orderBy(asc(mcpResources.name)),
      db().select().from(mcpResourceTemplates).where(eq(mcpResourceTemplates.organizationId, session.organizationId)).orderBy(asc(mcpResourceTemplates.name)),
      db().select().from(mcpPrompts).where(eq(mcpPrompts.organizationId, session.organizationId)).orderBy(asc(mcpPrompts.name)),
    ]);
    return apiSuccess({ servers, tools, resources, resourceTemplates, prompts }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/mcp");
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("integrations:manage");
    const body = await parseJson(request, updateSchema, 16 * 1024);

    if (body.action === "update_server") {
      const [current] = await db().select({ id: mcpServers.id, authMode: mcpServers.authMode })
        .from(mcpServers).where(and(
          eq(mcpServers.id, body.serverId),
          eq(mcpServers.organizationId, session.organizationId),
        )).limit(1);
      if (!current) throw new ApiError(404, "MCP_SERVER_NOT_FOUND", "خادم MCP غير موجود.");
      if (body.bearerToken !== undefined && current.authMode === "oauth") {
        throw new ApiError(409, "MCP_AUTH_MODE_CONFLICT", "لا يمكن تعيين رمز Bearer لاتصال OAuth.");
      }
      const [updated] = await db().transaction(async (tx) => {
        const [row] = await tx.update(mcpServers).set({
          name: body.name,
          enabled: body.enabled,
          encryptedBearerToken: body.bearerToken === undefined
            ? undefined
            : body.bearerToken === null ? null : encryptSecret(body.bearerToken, `mcp:${session.organizationId}`),
          tokenHint: body.bearerToken === undefined
            ? undefined
            : body.bearerToken === null ? null : maskSecret(body.bearerToken),
          status: body.bearerToken === undefined ? undefined : "pending",
          updatedAt: new Date(),
        }).where(and(
          eq(mcpServers.id, body.serverId),
          eq(mcpServers.organizationId, session.organizationId),
        )).returning({ id: mcpServers.id, name: mcpServers.name, enabled: mcpServers.enabled, tokenHint: mcpServers.tokenHint });
        if (!row) throw new ApiError(404, "MCP_SERVER_NOT_FOUND", "خادم MCP غير موجود.");
        await tx.insert(auditLogs).values({
          organizationId: session.organizationId,
          actorType: "user",
          actorId: session.userId,
          action: "mcp.server.update",
          resourceType: "mcp_server",
          resourceId: row.id,
          metadata: { requestId, changed: Object.keys(body).filter((key) => !["action", "bearerToken"].includes(key)), tokenRotated: body.bearerToken !== undefined },
        });
        return [row];
      });
      return apiSuccess(updated, requestId);
    }

    if (body.action === "set_tool_policy") {
      const [updated] = await db().transaction(async (tx) => {
        const [row] = await tx.update(mcpTools).set({ risk: body.risk, updatedAt: new Date() }).where(and(
          eq(mcpTools.id, body.id),
          eq(mcpTools.organizationId, session.organizationId),
        )).returning({ id: mcpTools.id, risk: mcpTools.risk });
        if (!row) throw new ApiError(404, "MCP_CATALOG_ITEM_NOT_FOUND", "عنصر MCP غير موجود.");
        await tx.insert(auditLogs).values({ organizationId: session.organizationId, actorType: "user", actorId: session.userId, action: "mcp.tool.policy.update", resourceType: "mcp_tool", resourceId: row.id, metadata: { requestId, risk: row.risk } });
        return [row];
      });
      return apiSuccess(updated, requestId);
    }

    const table = body.kind === "tool" ? mcpTools
      : body.kind === "resource" ? mcpResources
        : body.kind === "resource_template" ? mcpResourceTemplates : mcpPrompts;
    const [updated] = await db().transaction(async (tx) => {
      const [row] = await tx.update(table).set({ enabled: body.enabled, updatedAt: new Date() }).where(and(
        eq(table.id, body.id),
        eq(table.organizationId, session.organizationId),
      )).returning({ id: table.id, enabled: table.enabled });
      if (!row) throw new ApiError(404, "MCP_CATALOG_ITEM_NOT_FOUND", "عنصر MCP غير موجود.");
      await tx.insert(auditLogs).values({ organizationId: session.organizationId, actorType: "user", actorId: session.userId, action: "mcp.catalog.visibility.update", resourceType: `mcp_${body.kind}`, resourceId: row.id, metadata: { requestId, enabled: row.enabled } });
      return [row];
    });
    return apiSuccess(updated, requestId);
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
