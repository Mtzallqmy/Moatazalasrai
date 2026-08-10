import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agents, auditLogs, integrations } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { env } from "@/lib/config/env";
import {
  integrationCreateSchema,
  integrationDeleteSchema,
  integrationUpdateSchema,
} from "@/lib/http/contracts";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { configureAndVerifyTelegramWebhook } from "@/lib/integrations/telegram";
import { ensureTelegramChannelConnection, testAndPersistChannelConnection } from "@/lib/channels/connections";
import { decryptSecret, encryptSecret, hashApiKey, maskSecret } from "@/lib/security/encryption";
import { integrationAdapter } from "@/server/integrations/registry";

export const runtime = "nodejs";

const publicFields = {
  id: integrations.id,
  kind: integrations.kind,
  name: integrations.name,
  tokenHint: integrations.tokenHint,
  config: integrations.config,
  status: integrations.status,
  enabled: integrations.enabled,
  lastVerifiedAt: integrations.lastVerifiedAt,
  lastErrorCode: integrations.lastErrorCode,
  createdAt: integrations.createdAt,
  updatedAt: integrations.updatedAt,
};

function publicConfig(kind: "telegram" | "github", config: Record<string, unknown>) {
  const agentId = typeof config.agentId === "string" ? config.agentId : null;
  if (kind === "telegram") {
    return {
      botId: typeof config.botId === "number" || typeof config.botId === "string" ? String(config.botId) : null,
      botUsername: typeof config.botUsername === "string" ? config.botUsername : null,
      botName: typeof config.botName === "string" ? config.botName : null,
      agentId,
      webhookActive: config.webhookActive === true,
      webhookUrl: typeof config.webhookUrl === "string" ? config.webhookUrl : null,
      webhookPendingUpdates: typeof config.webhookPendingUpdates === "number" ? config.webhookPendingUpdates : null,
      webhookLastVerifiedAt: typeof config.webhookLastVerifiedAt === "string" ? config.webhookLastVerifiedAt : null,
    };
  }
  return { login: config.login, accountName: config.accountName, agentId };
}

async function validateAgent(organizationId: string, agentId?: string | null) {
  if (!agentId) return;
  const [agent] = await db().select({ id: agents.id }).from(agents).where(and(
    eq(agents.id, agentId),
    eq(agents.organizationId, organizationId),
    eq(agents.status, "published"),
  )).limit(1);
  if (!agent) throw new ApiError(422, "AGENT_UNAVAILABLE", "اختر وكيلًا منشورًا من المؤسسة الحالية لهذا التكامل.");
}

async function verifyIntegration(kind: "telegram" | "github", token: string) {
  const adapter = integrationAdapter(kind);
  return adapter.validateConfig(adapter.configSchema.parse({ token }));
}

function telegramWebhookUrl(integrationId: string) {
  const appUrl = env().appUrl?.replace(/\/$/, "");
  if (!appUrl) throw new ApiError(409, "APP_URL_REQUIRED", "اضبط APP_URL قبل تفعيل Telegram.");
  if (!appUrl.startsWith("https://")) {
    throw new ApiError(409, "TELEGRAM_HTTPS_REQUIRED", "Telegram Webhook يتطلب APP_URL عبر HTTPS.");
  }
  return `${appUrl}/api/webhooks/telegram/${integrationId}`;
}

async function configureTenantTelegram(input: { token: string; integrationId: string }) {
  const secret = randomBytes(32).toString("base64url");
  const url = telegramWebhookUrl(input.integrationId);
  const info = await configureAndVerifyTelegramWebhook({
    token: input.token,
    url,
    secretToken: secret,
  });
  return {
    webhookSecretHash: hashApiKey(secret),
    webhookActive: true,
    webhookUrl: url,
    webhookPendingUpdates: info.pending_update_count ?? 0,
    webhookLastVerifiedAt: new Date().toISOString(),
  };
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("integrations:read");
    const rows = await db().select(publicFields).from(integrations)
      .where(eq(integrations.organizationId, session.organizationId))
      .orderBy(desc(integrations.updatedAt));
    return apiSuccess(rows.map((row) => ({ ...row, config: publicConfig(row.kind, row.config) })), requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/integrations");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("integrations:manage");
    const body = await parseJson(request, integrationCreateSchema, 12 * 1024);
    await validateAgent(session.organizationId, body.agentId);
    const verifiedConfig = await verifyIntegration(body.kind, body.token);
    const [created] = await db().insert(integrations).values({
      organizationId: session.organizationId,
      kind: body.kind,
      name: body.name,
      encryptedToken: encryptSecret(body.token, `integration:${session.organizationId}`),
      tokenHint: maskSecret(body.token),
      config: {
        ...verifiedConfig,
        ...(body.agentId ? { agentId: body.agentId } : {}),
        ...(body.kind === "telegram" ? { webhookActive: false } : {}),
      },
      status: body.kind === "telegram" ? "pending" : "verified",
      lastVerifiedAt: body.kind === "github" ? new Date() : null,
    }).returning(publicFields);
    if (!created) throw new Error("INTEGRATION_CREATE_FAILED");

    let result = created;
    if (body.kind === "telegram") {
      try {
        const webhook = await configureTenantTelegram({ token: body.token, integrationId: created.id });
        [result] = await db().update(integrations).set({
          config: { ...created.config, ...webhook },
          status: "verified",
          lastVerifiedAt: new Date(),
          lastErrorCode: null,
          updatedAt: new Date(),
        }).where(and(
          eq(integrations.id, created.id),
          eq(integrations.organizationId, session.organizationId),
        )).returning(publicFields);
        const [integrationRecord] = await db().select().from(integrations).where(and(
          eq(integrations.id, created.id),
          eq(integrations.organizationId, session.organizationId),
        )).limit(1);
        if (!integrationRecord) throw new Error("TELEGRAM_INTEGRATION_RELOAD_FAILED");
        const connection = await ensureTelegramChannelConnection({ integration: integrationRecord, actorUserId: session.userId });
        const health = await testAndPersistChannelConnection(connection);
        if (health.status === "failed") throw new ApiError(422, health.errorCode ?? "TELEGRAM_HEALTH_FAILED", health.details);
      } catch (error) {
        const errorCode = error instanceof ApiError ? error.code : error instanceof Error ? error.name : "TELEGRAM_WEBHOOK_SETUP_FAILED";
        await db().update(integrations).set({
          status: "failed",
          lastErrorCode: errorCode,
          config: { ...created.config, webhookActive: false },
          updatedAt: new Date(),
        }).where(and(
          eq(integrations.id, created.id),
          eq(integrations.organizationId, session.organizationId),
        ));
        throw error;
      }
    }

    await db().insert(auditLogs).values({
      organizationId: session.organizationId,
      actorType: "user",
      actorId: session.userId,
      action: "integration.created",
      resourceType: "integration",
      resourceId: created.id,
      metadata: { kind: created.kind, agentId: body.agentId ?? null, webhookActive: body.kind === "telegram", requestId },
    });
    return apiSuccess({ ...result, config: publicConfig(result.kind, result.config) }, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/integrations");
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("integrations:manage");
    const body = await parseJson(request, integrationUpdateSchema, 12 * 1024);
    const [current] = await db().select().from(integrations).where(and(
      eq(integrations.id, body.id),
      eq(integrations.organizationId, session.organizationId),
    )).limit(1);
    if (!current) throw new ApiError(404, "INTEGRATION_NOT_FOUND", "التكامل غير موجود.");
    await validateAgent(session.organizationId, body.agentId);

    const token = body.token ?? decryptSecret(current.encryptedToken, `integration:${session.organizationId}`);
    const verifiedConfig = body.token ? await verifyIntegration(current.kind, token) : {};
    const previousAgentId = typeof current.config.agentId === "string" ? current.config.agentId : null;
    let config: Record<string, unknown> = {
      ...current.config,
      ...verifiedConfig,
      ...(body.agentId === undefined ? {} : { agentId: body.agentId }),
    };
    const shouldConfigureWebhook = current.kind === "telegram"
      && (body.token !== undefined || body.activateWebhook === true || current.config.webhookActive !== true);
    if (shouldConfigureWebhook) {
      config = { ...config, ...await configureTenantTelegram({ token, integrationId: current.id }) };
    }

    const now = new Date();
    const updated = await db().transaction(async (tx) => {
      const [row] = await tx.update(integrations).set({
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        ...(body.token === undefined ? {} : {
          encryptedToken: encryptSecret(body.token, `integration:${session.organizationId}`),
          tokenHint: maskSecret(body.token),
        }),
        config,
        status: "verified",
        lastVerifiedAt: body.token !== undefined || shouldConfigureWebhook ? now : current.lastVerifiedAt,
        lastErrorCode: null,
        updatedAt: now,
      }).where(and(
        eq(integrations.id, current.id),
        eq(integrations.organizationId, session.organizationId),
      )).returning(publicFields);
      if (!row) throw new ApiError(404, "INTEGRATION_NOT_FOUND", "التكامل غير موجود.");
      const nextAgentId = typeof config.agentId === "string" ? config.agentId : null;
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: body.agentId !== undefined && previousAgentId !== nextAgentId
          ? "integration.agent_changed"
          : "integration.updated",
        resourceType: "integration",
        resourceId: current.id,
        metadata: {
          kind: current.kind,
          previousAgentId,
          agentId: nextAgentId,
          enabled: row.enabled,
          webhookReactivated: shouldConfigureWebhook,
          tokenRotated: body.token !== undefined,
          requestId,
        },
      });
      return row;
    });
    if (current.kind === "telegram") {
      const [integrationRecord] = await db().select().from(integrations).where(and(
        eq(integrations.id, current.id), eq(integrations.organizationId, session.organizationId),
      )).limit(1);
      if (integrationRecord) {
        const connection = await ensureTelegramChannelConnection({ integration: integrationRecord, actorUserId: session.userId });
        if (integrationRecord.enabled) await testAndPersistChannelConnection(connection);
      }
    }
    return apiSuccess({ ...updated, config: publicConfig(updated.kind, updated.config) }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/integrations");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("integrations:manage");
    const body = await parseJson(request, integrationDeleteSchema, 4 * 1024);
    const deleted = await db().transaction(async (tx) => {
      const [row] = await tx.delete(integrations).where(and(
        eq(integrations.id, body.id),
        eq(integrations.organizationId, session.organizationId),
      )).returning({ id: integrations.id, kind: integrations.kind });
      if (!row) throw new ApiError(404, "INTEGRATION_NOT_FOUND", "التكامل غير موجود.");
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "integration.deleted",
        resourceType: "integration",
        resourceId: row.id,
        metadata: { kind: row.kind, requestId },
      });
      return row;
    });
    return apiSuccess({ deleted: true, id: deleted.id }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/integrations");
  }
}
