import { createHash } from "node:crypto";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mcpServers, mcpToolCalls, mcpTools } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { decryptSecret } from "@/lib/security/encryption";
import { callRemoteMcpTool, discoverMcpServer, finishMcpOAuth } from "./client";
import {
  DatabaseMcpOAuthProvider,
  HIGGSFIELD_MCP_ENDPOINT,
  isOfficialHiggsfieldEndpoint,
} from "./oauth";
import { classifyMcpTool } from "./tools";

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function publicResult(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}

async function serverSecret(server: typeof mcpServers.$inferSelect) {
  return server.encryptedBearerToken ? decryptSecret(server.encryptedBearerToken) : undefined;
}

function oauthCallbackUrl(serverId: string, origin?: string) {
  const base = process.env.APP_URL?.trim() || origin || "http://localhost:3000";
  const callback = new URL("/api/dashboard/mcp/oauth/callback", base);
  callback.searchParams.set("serverId", serverId);
  return callback.toString();
}

async function getMcpServer(organizationId: string, serverId: string) {
  const [server] = await db().select().from(mcpServers).where(and(
    eq(mcpServers.id, serverId),
    eq(mcpServers.organizationId, organizationId),
    eq(mcpServers.enabled, true),
  )).limit(1);
  if (!server) throw new ApiError(404, "MCP_SERVER_NOT_FOUND", "خادم MCP غير موجود أو معطل.");
  return server;
}

async function serverConnection(server: typeof mcpServers.$inferSelect, origin?: string) {
  if (server.authMode === "oauth") {
    if (!isOfficialHiggsfieldEndpoint(server.endpoint)) {
      throw new ApiError(400, "MCP_OAUTH_SERVER_NOT_ALLOWED", "OAuth مفعّل فقط لخادم Higgsfield الرسمي حالياً.");
    }
    return {
      endpoint: server.endpoint,
      authProvider: new DatabaseMcpOAuthProvider(server, oauthCallbackUrl(server.id, origin)),
    };
  }
  return {
    endpoint: server.endpoint,
    bearerToken: await serverSecret(server),
  };
}

export async function startHiggsfieldOAuth(organizationId: string, serverId: string, origin?: string) {
  const server = await getMcpServer(organizationId, serverId);
  const connection = await serverConnection(server, origin);
  if (!connection.authProvider) throw new ApiError(400, "MCP_OAUTH_NOT_ENABLED", "OAuth غير مفعّل لهذا الاتصال.");
  try {
    const discovered = await discoverMcpServer(connection);
    return { connected: true as const, discovered };
  } catch (error) {
    const authorizationUrl = connection.authProvider.authorizationUrl();
    if (error instanceof UnauthorizedError && authorizationUrl) {
      await db().update(mcpServers).set({
        status: "authorization_required",
        lastErrorCode: null,
        updatedAt: new Date(),
      }).where(eq(mcpServers.id, server.id));
      return { connected: false as const, authorizationUrl };
    }
    throw new ApiError(502, "MCP_OAUTH_START_FAILED", "تعذر بدء تسجيل الدخول الآمن إلى Higgsfield.");
  }
}

export async function completeHiggsfieldOAuth(input: {
  organizationId: string;
  serverId: string;
  state: string;
  code: string;
  origin?: string;
}) {
  const server = await getMcpServer(input.organizationId, input.serverId);
  const connection = await serverConnection(server, input.origin);
  const provider = connection.authProvider;
  if (!provider || !provider.verifyState(input.state)) {
    throw new ApiError(400, "MCP_OAUTH_STATE_INVALID", "تعذر التحقق من حالة OAuth. أعد بدء الربط.");
  }
  await finishMcpOAuth({
    endpoint: server.endpoint,
    authProvider: provider,
    authorizationCode: input.code,
  });
  return syncMcpServer(input.organizationId, server.id, input.origin);
}

export async function syncMcpServer(organizationId: string, serverId: string, origin?: string) {
  const server = await getMcpServer(organizationId, serverId);
  try {
    const discovered = await discoverMcpServer(await serverConnection(server, origin));
    await db().transaction(async (tx) => {
      await tx.update(mcpServers).set({
        status: "connected",
        protocolVersion: "2025-11-25",
        serverName: discovered.server?.name ?? null,
        serverVersion: discovered.server?.version ?? null,
        capabilities: discovered.capabilities as Record<string, unknown>,
        lastConnectedAt: new Date(),
        lastErrorCode: null,
        updatedAt: new Date(),
      }).where(eq(mcpServers.id, server.id));
      await tx.update(mcpTools).set({
        enabled: false,
        updatedAt: new Date(),
      }).where(eq(mcpTools.serverId, server.id));
      for (const tool of discovered.tools) {
        const inputSchema = tool.inputSchema as Record<string, unknown>;
        const outputSchema = tool.outputSchema as Record<string, unknown> | undefined;
        const classification = classifyMcpTool({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema,
          outputSchema,
        });
        await tx.insert(mcpTools).values({
          organizationId,
          serverId: server.id,
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema,
          outputSchema,
          annotations: (tool.annotations ?? {}) as Record<string, unknown>,
          schemaHash: digest({ inputSchema, outputSchema }),
          capability: classification.capability,
          mediaType: classification.mediaType,
          enabled: true,
        }).onConflictDoUpdate({
          target: [mcpTools.serverId, mcpTools.name],
          set: {
            title: tool.title,
            description: tool.description,
            inputSchema,
            outputSchema,
            annotations: (tool.annotations ?? {}) as Record<string, unknown>,
            schemaHash: digest({ inputSchema, outputSchema }),
            capability: classification.capability,
            mediaType: classification.mediaType,
            enabled: true,
            updatedAt: new Date(),
          },
        });
      }
    });
    return discovered;
  } catch (error) {
    if (error instanceof UnauthorizedError && server.authMode === "oauth") {
      await db().update(mcpServers).set({
        status: "authorization_required",
        lastErrorCode: "MCP_OAUTH_REQUIRED",
        updatedAt: new Date(),
      }).where(eq(mcpServers.id, server.id));
      throw new ApiError(409, "MCP_OAUTH_REQUIRED", "انتهت جلسة Higgsfield. أعد تسجيل الدخول عبر OAuth.");
    }
    await db().update(mcpServers).set({
      status: "failed",
      lastErrorCode: error instanceof Error ? error.name : "MCP_CONNECTION_FAILED",
      updatedAt: new Date(),
    }).where(eq(mcpServers.id, server.id));
    throw new ApiError(502, "MCP_CONNECTION_FAILED", "تعذر الاتصال بخادم MCP أو اكتشاف أدواته.");
  }
}

export async function executeMcpTool(input: {
  organizationId: string;
  toolId: string;
  arguments: Record<string, unknown>;
  userId?: string | null;
  runId?: string;
}) {
  const [row] = await db().select({
    tool: mcpTools,
    server: mcpServers,
  }).from(mcpTools)
    .innerJoin(mcpServers, eq(mcpServers.id, mcpTools.serverId))
    .where(and(
      eq(mcpTools.id, input.toolId),
      eq(mcpTools.organizationId, input.organizationId),
      eq(mcpTools.enabled, true),
      eq(mcpServers.enabled, true),
    ))
    .limit(1);
  if (!row) throw new ApiError(404, "MCP_TOOL_NOT_FOUND", "أداة MCP غير متاحة.");
  const [call] = await db().insert(mcpToolCalls).values({
    organizationId: input.organizationId,
    serverId: row.server.id,
    toolId: row.tool.id,
    runId: input.runId,
    requestedByUserId: input.userId,
    inputDigest: digest(input.arguments),
    status: "running",
  }).returning({ id: mcpToolCalls.id, createdAt: mcpToolCalls.createdAt });
  if (!call) throw new Error("MCP_CALL_CREATE_FAILED");
  try {
    const result = await callRemoteMcpTool({
      ...await serverConnection(row.server),
      name: row.tool.name,
      arguments: input.arguments,
    });
    const completedAt = new Date();
    await db().update(mcpToolCalls).set({
      status: result.isError ? "failed" : "completed",
      result: publicResult(result),
      errorCode: result.isError ? "MCP_TOOL_ERROR" : null,
      durationMs: completedAt.getTime() - call.createdAt.getTime(),
      completedAt,
    }).where(eq(mcpToolCalls.id, call.id));
    return { callId: call.id, result };
  } catch (error) {
    const completedAt = new Date();
    await db().update(mcpToolCalls).set({
      status: "failed",
      errorCode: error instanceof Error ? error.name : "MCP_TOOL_FAILED",
      durationMs: completedAt.getTime() - call.createdAt.getTime(),
      completedAt,
    }).where(eq(mcpToolCalls.id, call.id));
    if (error instanceof UnauthorizedError && row.server.authMode === "oauth") {
      await db().update(mcpServers).set({
        status: "authorization_required",
        lastErrorCode: "MCP_OAUTH_REQUIRED",
        updatedAt: completedAt,
      }).where(eq(mcpServers.id, row.server.id));
      throw new ApiError(409, "MCP_OAUTH_REQUIRED", "انتهت جلسة Higgsfield. أعد تسجيل الدخول عبر OAuth ثم حاول مجدداً.");
    }
    throw new ApiError(502, "MCP_TOOL_FAILED", "فشل تنفيذ أداة MCP البعيدة.");
  }
}

export async function createHiggsfieldServer(organizationId: string) {
  const existing = await db().select({ id: mcpServers.id, authMode: mcpServers.authMode }).from(mcpServers).where(and(
    eq(mcpServers.organizationId, organizationId),
    eq(mcpServers.endpoint, HIGGSFIELD_MCP_ENDPOINT),
  )).limit(1);
  if (existing[0]) {
    if (existing[0].authMode !== "oauth") {
      await db().update(mcpServers).set({
        authMode: "oauth",
        encryptedBearerToken: null,
        tokenHint: "OAuth 2.1",
        status: "pending",
        updatedAt: new Date(),
      }).where(eq(mcpServers.id, existing[0].id));
    }
    return { id: existing[0].id };
  }
  const [created] = await db().insert(mcpServers).values({
    organizationId,
    name: "Higgsfield",
    endpoint: HIGGSFIELD_MCP_ENDPOINT,
    authMode: "oauth",
    status: "pending",
    tokenHint: "OAuth 2.1",
  }).returning({ id: mcpServers.id });
  if (!created) throw new Error("MCP_SERVER_CREATE_FAILED");
  return created;
}
