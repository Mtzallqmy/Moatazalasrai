import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { mcpServers, mcpTools } from "@/db/schema";
import { executeMcpTool, syncMcpServer } from "@/ai/mcp/service";
import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, ApiError, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { encryptSecret, maskSecret } from "@/lib/security/encryption";
import { validateProviderBaseUrl } from "@/lib/security/provider-network";

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
]);

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("integrations:read");
    const [servers, tools] = await Promise.all([
      db().select({
        id: mcpServers.id,
        name: mcpServers.name,
        endpoint: mcpServers.endpoint,
        tokenHint: mcpServers.tokenHint,
        status: mcpServers.status,
        serverName: mcpServers.serverName,
        serverVersion: mcpServers.serverVersion,
        protocolVersion: mcpServers.protocolVersion,
        lastConnectedAt: mcpServers.lastConnectedAt,
        lastErrorCode: mcpServers.lastErrorCode,
        enabled: mcpServers.enabled,
      }).from(mcpServers).where(eq(mcpServers.organizationId, session.organizationId))
        .orderBy(desc(mcpServers.updatedAt)),
      db().select().from(mcpTools).where(and(
        eq(mcpTools.organizationId, session.organizationId),
        eq(mcpTools.enabled, true),
      )).orderBy(mcpTools.name),
    ]);
    return apiSuccess({ servers, tools }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/mcp");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("integrations:manage");
    const body = await parseJson(request, actionSchema, 24 * 1024);
    if (body.action === "create") {
      const endpoint = (await validateProviderBaseUrl(body.endpoint)).normalizedUrl;
      const [created] = await db().insert(mcpServers).values({
        organizationId: session.organizationId,
        name: body.name,
        endpoint,
        encryptedBearerToken: body.bearerToken ? encryptSecret(body.bearerToken) : null,
        tokenHint: body.bearerToken ? maskSecret(body.bearerToken) : null,
      }).returning({ id: mcpServers.id });
      if (!created) throw new Error("MCP_SERVER_CREATE_FAILED");
      const discovery = await syncMcpServer(session.organizationId, created.id);
      return apiSuccess({ serverId: created.id, toolCount: discovery.tools.length }, requestId, 201);
    }
    if (body.action === "sync") {
      const discovery = await syncMcpServer(session.organizationId, body.serverId);
      return apiSuccess({ serverId: body.serverId, toolCount: discovery.tools.length }, requestId);
    }
    const result = await executeMcpTool({
      organizationId: session.organizationId,
      toolId: body.toolId,
      arguments: body.arguments,
      userId: session.userId,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/mcp");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("integrations:manage");
    const serverId = new URL(request.url).searchParams.get("serverId");
    if (!serverId || !z.string().uuid().safeParse(serverId).success) {
      throw new ApiError(400, "MCP_SERVER_ID_REQUIRED", "معرّف خادم MCP مطلوب.");
    }
    const [deleted] = await db().delete(mcpServers).where(and(
      eq(mcpServers.id, serverId),
      eq(mcpServers.organizationId, session.organizationId),
    )).returning({ id: mcpServers.id });
    if (!deleted) throw new ApiError(404, "MCP_SERVER_NOT_FOUND", "خادم MCP غير موجود.");
    return apiSuccess({ deleted: true, id: deleted.id }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/mcp");
  }
}
