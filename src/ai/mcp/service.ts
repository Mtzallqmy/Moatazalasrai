import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mcpServers, mcpToolCalls, mcpTools } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { decryptSecret } from "@/lib/security/encryption";
import { callRemoteMcpTool, discoverMcpServer } from "./client";

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

export async function syncMcpServer(organizationId: string, serverId: string) {
  const [server] = await db().select().from(mcpServers).where(and(
    eq(mcpServers.id, serverId),
    eq(mcpServers.organizationId, organizationId),
    eq(mcpServers.enabled, true),
  )).limit(1);
  if (!server) throw new ApiError(404, "MCP_SERVER_NOT_FOUND", "خادم MCP غير موجود أو معطل.");
  try {
    const discovered = await discoverMcpServer({
      endpoint: server.endpoint,
      bearerToken: await serverSecret(server),
    });
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
      for (const tool of discovered.tools) {
        const inputSchema = tool.inputSchema as Record<string, unknown>;
        const outputSchema = tool.outputSchema as Record<string, unknown> | undefined;
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
        }).onConflictDoUpdate({
          target: [mcpTools.serverId, mcpTools.name],
          set: {
            title: tool.title,
            description: tool.description,
            inputSchema,
            outputSchema,
            annotations: (tool.annotations ?? {}) as Record<string, unknown>,
            schemaHash: digest({ inputSchema, outputSchema }),
            updatedAt: new Date(),
          },
        });
      }
    });
    return discovered;
  } catch (error) {
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
      endpoint: row.server.endpoint,
      bearerToken: await serverSecret(row.server),
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
    throw new ApiError(502, "MCP_TOOL_FAILED", "فشل تنفيذ أداة MCP البعيدة.");
  }
}
