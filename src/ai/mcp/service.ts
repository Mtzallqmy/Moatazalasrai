import { createHash } from "node:crypto";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { mcpServers, mcpToolCalls, mcpTools } from "@/db/schema";
import {
  mcpContentReads,
  mcpPrompts,
  mcpResources,
  mcpResourceTemplates,
} from "@/db/mcp-catalog-schema";
import { ApiError } from "@/lib/http/api";
import { decryptSecret } from "@/lib/security/encryption";
import {
  callRemoteMcpTool,
  discoverMcpServer,
  finishMcpOAuth,
  getRemoteMcpPrompt,
  readRemoteMcpResource,
} from "./client";
import {
  DatabaseMcpOAuthProvider,
  HIGGSFIELD_MCP_ENDPOINT,
  isOfficialHiggsfieldEndpoint,
} from "./oauth";
import { classifyMcpTool } from "./tools";
import {
  assertMcpJsonLimits,
  safeMcpResultRecord,
  validateMcpToolInput,
  validateMcpToolOutput,
} from "./validation";

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function payloadBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function maxMcpPayloadBytes() {
  const configured = Number(process.env.MCP_MAX_CONTENT_BYTES ?? 25 * 1024 * 1024);
  if (!Number.isFinite(configured)) return 25 * 1024 * 1024;
  return Math.min(Math.max(Math.floor(configured), 1024 * 1024), 100 * 1024 * 1024);
}

async function serverSecret(server: typeof mcpServers.$inferSelect) {
  return server.encryptedBearerToken ? decryptSecret(server.encryptedBearerToken, `mcp:${server.organizationId}`) : undefined;
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

function templateMayResolve(template: string, uri: string) {
  const first = template.indexOf("{");
  if (first < 0) return template === uri;
  const last = template.lastIndexOf("}");
  const prefix = template.slice(0, first);
  const suffix = last >= first ? template.slice(last + 1) : "";
  return uri.startsWith(prefix) && uri.endsWith(suffix) && uri.length >= prefix.length + suffix.length;
}

async function assertResourceAllowed(organizationId: string, serverId: string, uri: string) {
  const [resource, templates] = await Promise.all([
    db().select({ id: mcpResources.id }).from(mcpResources).where(and(
      eq(mcpResources.organizationId, organizationId),
      eq(mcpResources.serverId, serverId),
      eq(mcpResources.uri, uri),
      eq(mcpResources.enabled, true),
    )).limit(1),
    db().select({ uriTemplate: mcpResourceTemplates.uriTemplate }).from(mcpResourceTemplates).where(and(
      eq(mcpResourceTemplates.organizationId, organizationId),
      eq(mcpResourceTemplates.serverId, serverId),
      eq(mcpResourceTemplates.enabled, true),
    )),
  ]);
  if (resource[0] || templates.some((row) => templateMayResolve(row.uriTemplate, uri))) return;
  throw new ApiError(404, "MCP_RESOURCE_NOT_DISCOVERED", "المورد غير موجود في فهرس MCP الموثوق لهذا الخادم.");
}

async function assertPromptAllowed(organizationId: string, serverId: string, name: string) {
  const [prompt] = await db().select({ id: mcpPrompts.id }).from(mcpPrompts).where(and(
    eq(mcpPrompts.organizationId, organizationId),
    eq(mcpPrompts.serverId, serverId),
    eq(mcpPrompts.name, name),
    eq(mcpPrompts.enabled, true),
  )).limit(1);
  if (!prompt) throw new ApiError(404, "MCP_PROMPT_NOT_DISCOVERED", "قالب MCP غير موجود أو معطل.");
}

async function recordContentRead<T>(input: {
  organizationId: string;
  serverId: string;
  userId?: string | null;
  kind: "resource" | "prompt";
  identifier: string;
  operation: () => Promise<T>;
}) {
  const [row] = await db().insert(mcpContentReads).values({
    organizationId: input.organizationId,
    serverId: input.serverId,
    requestedByUserId: input.userId,
    kind: input.kind,
    identifier: input.identifier,
  }).returning({ id: mcpContentReads.id, createdAt: mcpContentReads.createdAt });
  if (!row) throw new Error("MCP_CONTENT_READ_CREATE_FAILED");
  try {
    const result = await input.operation();
    const bytes = payloadBytes(result);
    if (bytes > maxMcpPayloadBytes()) {
      throw new ApiError(413, "MCP_CONTENT_TOO_LARGE", "حجم محتوى MCP يتجاوز الحد الإنتاجي المسموح.", {
        bytes,
        maxBytes: maxMcpPayloadBytes(),
      });
    }
    const completedAt = new Date();
    await db().update(mcpContentReads).set({
      status: "completed",
      payloadBytes: bytes,
      resultDigest: digest(result),
      durationMs: completedAt.getTime() - row.createdAt.getTime(),
      completedAt,
    }).where(eq(mcpContentReads.id, row.id));
    return result;
  } catch (error) {
    const completedAt = new Date();
    await db().update(mcpContentReads).set({
      status: "failed",
      errorCode: error instanceof ApiError ? error.code : error instanceof Error ? error.name : "MCP_CONTENT_READ_FAILED",
      durationMs: completedAt.getTime() - row.createdAt.getTime(),
      completedAt,
    }).where(eq(mcpContentReads.id, row.id));
    throw error;
  }
}

export async function startHiggsfieldOAuth(organizationId: string, serverId: string, origin?: string) {
  const server = await getMcpServer(organizationId, serverId);
  const connection = await serverConnection(server, origin);
  if (!("authProvider" in connection) || !connection.authProvider) {
    throw new ApiError(400, "MCP_OAUTH_NOT_ENABLED", "OAuth غير مفعّل لهذا الاتصال.");
  }
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
  const provider = "authProvider" in connection ? connection.authProvider : undefined;
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
        capabilities: {
          ...(discovered.capabilities as Record<string, unknown>),
          discoveryErrors: discovered.discoveryErrors,
          catalogCounts: {
            tools: discovered.tools.length,
            resources: discovered.resources.length,
            resourceTemplates: discovered.resourceTemplates.length,
            prompts: discovered.prompts.length,
          },
        },
        lastConnectedAt: new Date(),
        lastErrorCode: discovered.discoveryErrors[0] ?? null,
        updatedAt: new Date(),
      }).where(eq(mcpServers.id, server.id));

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
            updatedAt: new Date(),
          },
        });
      }

      for (const resource of discovered.resources) {
        await tx.insert(mcpResources).values({
          organizationId,
          serverId: server.id,
          uri: resource.uri,
          name: resource.name,
          title: resource.title,
          description: resource.description,
          mimeType: resource.mimeType,
          sizeBytes: typeof resource.size === "number" && resource.size <= 2_147_483_647 ? resource.size : null,
          annotations: resource.annotations ?? {},
          icons: resource.icons ?? [],
          metadata: resource._meta ?? {},
          enabled: true,
        }).onConflictDoUpdate({
          target: [mcpResources.serverId, mcpResources.uri],
          set: {
            name: resource.name,
            title: resource.title,
            description: resource.description,
            mimeType: resource.mimeType,
            sizeBytes: typeof resource.size === "number" && resource.size <= 2_147_483_647 ? resource.size : null,
            annotations: resource.annotations ?? {},
            icons: resource.icons ?? [],
            metadata: resource._meta ?? {},
            updatedAt: new Date(),
          },
        });
      }

      for (const template of discovered.resourceTemplates) {
        await tx.insert(mcpResourceTemplates).values({
          organizationId,
          serverId: server.id,
          uriTemplate: template.uriTemplate,
          name: template.name,
          title: template.title,
          description: template.description,
          mimeType: template.mimeType,
          annotations: template.annotations ?? {},
          icons: template.icons ?? [],
          metadata: template._meta ?? {},
          enabled: true,
        }).onConflictDoUpdate({
          target: [mcpResourceTemplates.serverId, mcpResourceTemplates.uriTemplate],
          set: {
            name: template.name,
            title: template.title,
            description: template.description,
            mimeType: template.mimeType,
            annotations: template.annotations ?? {},
            icons: template.icons ?? [],
            metadata: template._meta ?? {},
            updatedAt: new Date(),
          },
        });
      }

      for (const prompt of discovered.prompts) {
        await tx.insert(mcpPrompts).values({
          organizationId,
          serverId: server.id,
          name: prompt.name,
          title: prompt.title,
          description: prompt.description,
          arguments: prompt.arguments ?? [],
          icons: prompt.icons ?? [],
          metadata: prompt._meta ?? {},
          enabled: true,
        }).onConflictDoUpdate({
          target: [mcpPrompts.serverId, mcpPrompts.name],
          set: {
            title: prompt.title,
            description: prompt.description,
            arguments: prompt.arguments ?? [],
            icons: prompt.icons ?? [],
            metadata: prompt._meta ?? {},
            updatedAt: new Date(),
          },
        });
      }

      // Reconciliation must not overwrite an operator's explicit show/hide choice.
      // Only entries absent from a successfully discovered catalog are disabled.
      // A partial discovery failure is fail-safe: retain the last known catalog.
      if (!discovered.discoveryErrors.includes("MCP_TOOLS_DISCOVERY_FAILED")) {
        const names = discovered.tools.map((tool) => tool.name);
        await tx.update(mcpTools).set({ enabled: false, updatedAt: new Date() }).where(and(
          eq(mcpTools.organizationId, organizationId),
          eq(mcpTools.serverId, server.id),
          names.length ? notInArray(mcpTools.name, names) : undefined,
        ));
      }
      if (!discovered.discoveryErrors.includes("MCP_RESOURCES_DISCOVERY_FAILED")) {
        const uris = discovered.resources.map((resource) => resource.uri);
        await tx.update(mcpResources).set({ enabled: false, updatedAt: new Date() }).where(and(
          eq(mcpResources.organizationId, organizationId),
          eq(mcpResources.serverId, server.id),
          uris.length ? notInArray(mcpResources.uri, uris) : undefined,
        ));
      }
      if (!discovered.discoveryErrors.includes("MCP_RESOURCE_TEMPLATES_DISCOVERY_FAILED")) {
        const templates = discovered.resourceTemplates.map((template) => template.uriTemplate);
        await tx.update(mcpResourceTemplates).set({ enabled: false, updatedAt: new Date() }).where(and(
          eq(mcpResourceTemplates.organizationId, organizationId),
          eq(mcpResourceTemplates.serverId, server.id),
          templates.length ? notInArray(mcpResourceTemplates.uriTemplate, templates) : undefined,
        ));
      }
      if (!discovered.discoveryErrors.includes("MCP_PROMPTS_DISCOVERY_FAILED")) {
        const names = discovered.prompts.map((prompt) => prompt.name);
        await tx.update(mcpPrompts).set({ enabled: false, updatedAt: new Date() }).where(and(
          eq(mcpPrompts.organizationId, organizationId),
          eq(mcpPrompts.serverId, server.id),
          names.length ? notInArray(mcpPrompts.name, names) : undefined,
        ));
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
    throw new ApiError(502, "MCP_CONNECTION_FAILED", "تعذر الاتصال بخادم MCP أو اكتشاف محتواه.");
  }
}

export async function readMcpResource(input: {
  organizationId: string;
  serverId: string;
  uri: string;
  userId?: string | null;
}) {
  const server = await getMcpServer(input.organizationId, input.serverId);
  await assertResourceAllowed(input.organizationId, server.id, input.uri);
  const connection = await serverConnection(server);
  return recordContentRead({
    organizationId: input.organizationId,
    serverId: server.id,
    userId: input.userId,
    kind: "resource",
    identifier: input.uri,
    operation: () => readRemoteMcpResource({
      ...connection,
      uri: input.uri,
    }),
  });
}

export async function renderMcpPrompt(input: {
  organizationId: string;
  serverId: string;
  name: string;
  arguments?: Record<string, string>;
  userId?: string | null;
}) {
  const server = await getMcpServer(input.organizationId, input.serverId);
  await assertPromptAllowed(input.organizationId, server.id, input.name);
  const connection = await serverConnection(server);
  return recordContentRead({
    organizationId: input.organizationId,
    serverId: server.id,
    userId: input.userId,
    kind: "prompt",
    identifier: input.name,
    operation: () => getRemoteMcpPrompt({
      ...connection,
      name: input.name,
      arguments: input.arguments,
    }),
  });
}

function toolTimeoutMs(capability: string) {
  if (capability === "video_generation") return 15 * 60_000;
  if (capability === "image_generation" || capability === "media_processing") return 8 * 60_000;
  return 2 * 60_000;
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
  validateMcpToolInput(row.tool.inputSchema, row.tool.schemaHash, input.arguments);
  if (!input.runId && row.tool.risk !== "low") {
    throw new ApiError(
      409,
      "MCP_TOOL_APPROVAL_REQUIRED",
      "هذه الأداة تتطلب تشغيلها من داخل وكيل مع موافقة صريحة قبل التنفيذ.",
    );
  }
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
      timeoutMs: toolTimeoutMs(row.tool.capability),
    });
    assertMcpJsonLimits(result);
    if (row.tool.outputSchema) {
      validateMcpToolOutput(row.tool.outputSchema, row.tool.schemaHash, result.structuredContent);
    }
    const completedAt = new Date();
    await db().update(mcpToolCalls).set({
      status: result.isError ? "failed" : "completed",
      result: safeMcpResultRecord(result),
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
