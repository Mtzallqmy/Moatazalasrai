import { createHash } from "node:crypto";
import { and, count, eq, sql } from "drizzle-orm";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { db } from "@/db";
import { databaseRows } from "@/db/result";
import { mcpToolCallsRuntime } from "@/db/agent-runtime-schema";
import { agentMcpTools, mcpServers, mcpTools } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { decryptSecret } from "@/lib/security/encryption";
import { maxTotalToolCallsPerRun } from "@/lib/ai-sdk/limits";
import { appendRunEvent } from "@/lib/ai-sdk/run-events";
import { persistRunStep } from "@/lib/ai-sdk/run-steps";
import { callRemoteMcpTool } from "@/ai/mcp/client";
import { DatabaseMcpOAuthProvider, isOfficialHiggsfieldEndpoint } from "@/ai/mcp/oauth";
import { assertMcpJsonLimits, validateMcpToolInput, validateMcpToolOutput } from "@/ai/mcp/validation";

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(422, "MCP_TOOL_ARGUMENTS_INVALID", "معاملات أداة MCP يجب أن تكون كائن JSON.");
  }
  return value as Record<string, unknown>;
}

function publicResult(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
}

function toolTimeoutMs(capability: string) {
  if (capability === "video_generation") return 15 * 60_000;
  if (capability === "image_generation" || capability === "media_processing") return 8 * 60_000;
  return 2 * 60_000;
}

function oauthCallbackUrl(serverId: string) {
  const base = process.env.APP_URL?.trim() || "http://localhost:3000";
  const callback = new URL("/api/dashboard/mcp/oauth/callback", base);
  callback.searchParams.set("serverId", serverId);
  return callback.toString();
}

async function serverConnection(server: typeof mcpServers.$inferSelect) {
  if (server.authMode === "oauth") {
    if (!isOfficialHiggsfieldEndpoint(server.endpoint)) {
      throw new ApiError(400, "MCP_OAUTH_SERVER_NOT_ALLOWED", "OAuth غير مسموح لهذا الخادم.");
    }
    return {
      endpoint: server.endpoint,
      authProvider: new DatabaseMcpOAuthProvider(server, oauthCallbackUrl(server.id)),
    };
  }
  return {
    endpoint: server.endpoint,
    bearerToken: server.encryptedBearerToken ? decryptSecret(server.encryptedBearerToken, `mcp:${server.organizationId}`) : undefined,
  };
}

type Binding = {
  maxCallsPerRun: number;
  approvalMode: string;
  tool: typeof mcpTools.$inferSelect;
  server: typeof mcpServers.$inferSelect;
};

async function reserveCall(input: {
  organizationId: string;
  runId: string;
  toolCallId: string;
  toolId: string;
  userId?: string | null;
  inputDigest: string;
  binding: Binding;
}) {
  return db().transaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT "id" FROM "runs"
      WHERE "id" = ${input.runId} AND "organization_id" = ${input.organizationId}
      FOR UPDATE
    `);
    if (databaseRows(locked).length === 0) throw new ApiError(404, "RUN_NOT_FOUND", "عملية التشغيل غير موجودة.");

    const [duplicate] = await tx.select().from(mcpToolCallsRuntime).where(and(
      eq(mcpToolCallsRuntime.organizationId, input.organizationId),
      eq(mcpToolCallsRuntime.runId, input.runId),
      eq(mcpToolCallsRuntime.toolCallId, input.toolCallId),
    )).limit(1);
    if (duplicate) {
      if (duplicate.inputDigest !== input.inputDigest) {
        throw new ApiError(409, "TOOL_CALL_IDEMPOTENCY_CONFLICT", "وصل toolCallId نفسه بمعاملات مختلفة.");
      }
      return { kind: "duplicate" as const, call: duplicate };
    }

    const [[toolCount], [totalCount]] = await Promise.all([
      tx.select({ value: count() }).from(mcpToolCallsRuntime).where(and(
        eq(mcpToolCallsRuntime.organizationId, input.organizationId),
        eq(mcpToolCallsRuntime.runId, input.runId),
        eq(mcpToolCallsRuntime.toolId, input.toolId),
      )),
      tx.select({ value: count() }).from(mcpToolCallsRuntime).where(and(
        eq(mcpToolCallsRuntime.organizationId, input.organizationId),
        eq(mcpToolCallsRuntime.runId, input.runId),
      )),
    ]);
    if ((toolCount?.value ?? 0) >= input.binding.maxCallsPerRun) {
      throw new ApiError(429, "TOOL_CALL_LIMIT_EXCEEDED", "تجاوزت الأداة الحد المسموح لها في هذا التشغيل.");
    }
    if ((totalCount?.value ?? 0) >= maxTotalToolCallsPerRun()) {
      throw new ApiError(429, "TOTAL_TOOL_CALL_LIMIT_EXCEEDED", "تجاوز التشغيل الحد الإجمالي لاستدعاءات الأدوات.");
    }

    const [created] = await tx.insert(mcpToolCallsRuntime).values({
      organizationId: input.organizationId,
      serverId: input.binding.server.id,
      toolId: input.binding.tool.id,
      runId: input.runId,
      requestedByUserId: input.userId,
      inputDigest: input.inputDigest,
      status: "running",
      toolCallId: input.toolCallId,
    }).returning();
    if (!created) throw new Error("MCP_CALL_CREATE_FAILED");
    return { kind: "created" as const, call: created };
  });
}

export async function executeMcpToolIdempotent(input: {
  organizationId: string;
  agentId: string;
  toolId: string;
  arguments: unknown;
  userId?: string | null;
  runId: string;
  toolCallId: string;
  stepNumber: number;
}) {
  const args = asRecord(input.arguments);
  const inputDigest = digest(args);
  const [binding] = await db().select({
    maxCallsPerRun: agentMcpTools.maxCallsPerRun,
    approvalMode: agentMcpTools.approvalMode,
    tool: mcpTools,
    server: mcpServers,
  }).from(agentMcpTools)
    .innerJoin(mcpTools, eq(mcpTools.id, agentMcpTools.toolId))
    .innerJoin(mcpServers, eq(mcpServers.id, mcpTools.serverId))
    .where(and(
      eq(agentMcpTools.organizationId, input.organizationId),
      eq(agentMcpTools.agentId, input.agentId),
      eq(agentMcpTools.toolId, input.toolId),
      eq(mcpTools.organizationId, input.organizationId),
      eq(mcpTools.enabled, true),
      eq(mcpServers.organizationId, input.organizationId),
      eq(mcpServers.enabled, true),
      eq(mcpServers.status, "connected"),
    )).limit(1);
  if (!binding) throw new ApiError(404, "MCP_TOOL_NOT_LINKED", "أداة MCP غير مرتبطة بهذا الوكيل أو خادمها غير متصل.");
  validateMcpToolInput(binding.tool.inputSchema, binding.tool.schemaHash, args);

  const reservation = await reserveCall({
    organizationId: input.organizationId,
    runId: input.runId,
    toolCallId: input.toolCallId,
    toolId: input.toolId,
    userId: input.userId,
    inputDigest,
    binding,
  });
  if (reservation.kind === "duplicate") {
    const duplicate = reservation.call;
    if (duplicate.status === "completed") return { call: duplicate, result: duplicate.result, duplicate: true };
    if (duplicate.status === "running") return { call: duplicate, status: "running" as const, duplicate: true };
    throw new ApiError(409, duplicate.errorCode ?? "MCP_TOOL_FAILED", "فشل الاستدعاء السابق ولا يمكن تكراره تلقائيًا بأمان.");
  }
  const call = reservation.call;

  await appendRunEvent({
    organizationId: input.organizationId,
    runId: input.runId,
    type: "tool.call.started",
    payload: { toolId: binding.tool.id, toolCallId: input.toolCallId, serverId: binding.server.id },
  });
  const startedAt = call.createdAt;
  try {
    const result = await callRemoteMcpTool({
      ...await serverConnection(binding.server),
      name: binding.tool.name,
      arguments: args,
      timeoutMs: toolTimeoutMs(binding.tool.capability),
    });
    assertMcpJsonLimits(result);
    if (binding.tool.outputSchema) {
      validateMcpToolOutput(binding.tool.outputSchema, binding.tool.schemaHash, result.structuredContent);
    }
    const completedAt = new Date();
    const status = result.isError ? "failed" : "completed";
    const [updated] = await db().update(mcpToolCallsRuntime).set({
      status,
      result: publicResult(result),
      errorCode: result.isError ? "MCP_TOOL_ERROR" : null,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      completedAt,
    }).where(and(
      eq(mcpToolCallsRuntime.id, call.id),
      eq(mcpToolCallsRuntime.organizationId, input.organizationId),
    )).returning();
    await persistRunStep({
      organizationId: input.organizationId,
      runId: input.runId,
      stepNumber: input.stepNumber,
      stepType: "tool_result",
      status: result.isError ? "failed" : "completed",
      toolCallId: input.toolCallId,
      toolId: binding.tool.id,
      input: args,
      output: result,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      errorCode: result.isError ? "MCP_TOOL_ERROR" : undefined,
      metadata: { serverId: binding.server.id, capability: binding.tool.capability },
    });
    await appendRunEvent({
      organizationId: input.organizationId,
      runId: input.runId,
      type: result.isError ? "tool.call.failed" : "tool.call.completed",
      payload: { toolId: binding.tool.id, toolCallId: input.toolCallId, durationMs: completedAt.getTime() - startedAt.getTime() },
    });
    if (result.isError) throw new ApiError(502, "MCP_TOOL_ERROR", "أرجع خادم MCP خطأ أثناء تنفيذ الأداة.");
    return { call: updated ?? call, result, duplicate: false };
  } catch (error) {
    const completedAt = new Date();
    const errorCode = error instanceof ApiError ? error.code : error instanceof Error ? error.name : "MCP_TOOL_FAILED";
    await db().update(mcpToolCallsRuntime).set({
      status: "failed",
      errorCode,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      completedAt,
    }).where(and(
      eq(mcpToolCallsRuntime.id, call.id),
      eq(mcpToolCallsRuntime.organizationId, input.organizationId),
    ));
    await appendRunEvent({
      organizationId: input.organizationId,
      runId: input.runId,
      type: "tool.call.failed",
      payload: { toolId: binding.tool.id, toolCallId: input.toolCallId, errorCode },
    });
    if (error instanceof UnauthorizedError && binding.server.authMode === "oauth") {
      await db().update(mcpServers).set({
        status: "authorization_required",
        lastErrorCode: "MCP_OAUTH_REQUIRED",
        updatedAt: completedAt,
      }).where(and(eq(mcpServers.id, binding.server.id), eq(mcpServers.organizationId, input.organizationId)));
      throw new ApiError(409, "MCP_OAUTH_REQUIRED", "انتهت جلسة MCP OAuth. أعد تسجيل الدخول ثم حاول مجددًا.");
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "MCP_TOOL_FAILED", "فشل تنفيذ أداة MCP البعيدة.");
  }
}
