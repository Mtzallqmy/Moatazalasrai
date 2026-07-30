import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, auditLogs, modelCatalog, organizations, providerCredentials } from "@/db/schema";
import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { providerDeleteSchema, providerInputSchema, providerUpdateSchema } from "@/lib/http/contracts";
import { getProviderPreset, resolveProviderPreset } from "@/lib/providers/catalog";
import { defaultBaseUrl, inferProviderSlug, validateProvider } from "@/lib/providers/registry";
import type { ProviderKind } from "@/lib/providers/types";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/security/encryption";
import { inferModelCapabilities, isFreeTierModel } from "@/server/models/capabilities";

const activeProvider = sql`"provider_credentials"."deleted_at" IS NULL`;

const publicProviderSelection = {
  id: providerCredentials.id,
  provider: providerCredentials.provider,
  name: providerCredentials.name,
  baseUrl: providerCredentials.baseUrl,
  secretHint: providerCredentials.secretHint,
  discoveredModels: providerCredentials.discoveredModels,
  validationStatus: providerCredentials.validationStatus,
  lastValidatedAt: providerCredentials.lastValidatedAt,
  lastValidationLatencyMs: providerCredentials.lastValidationLatencyMs,
  lastErrorCode: providerCredentials.lastErrorCode,
  consecutiveFailures: providerCredentials.consecutiveFailures,
  circuitOpenUntil: providerCredentials.circuitOpenUntil,
  enabled: providerCredentials.enabled,
  createdAt: providerCredentials.createdAt,
  updatedAt: providerCredentials.updatedAt,
};

function publicProvider<T extends { provider: ProviderKind; baseUrl: string }>(row: T) {
  const providerSlug = inferProviderSlug(row.provider, row.baseUrl);
  const preset = getProviderPreset(providerSlug);
  return {
    ...row,
    providerSlug,
    providerLabel: preset?.labelAr ?? preset?.label ?? providerSlug,
    apiStyle: preset?.apiStyle ?? "openai_chat",
  };
}

function requestedPreset(provider: ProviderKind, slug?: string) {
  if (!slug) return resolveProviderPreset({ provider });
  const preset = getProviderPreset(slug);
  if (!preset || preset.provider !== provider) {
    throw new ApiError(400, "PROVIDER_PRESET_INVALID", "نوع المزود لا يطابق الإعداد المختار.");
  }
  return preset;
}

async function replaceModels(input: {
  organizationId: string;
  credentialId: string;
  provider: ProviderKind;
  models: string[];
  latencyMs: number;
}) {
  const now = new Date();
  await db().transaction(async (tx) => {
    await tx.update(modelCatalog).set({ available: false, updatedAt: now }).where(and(
      eq(modelCatalog.organizationId, input.organizationId),
      eq(modelCatalog.providerCredentialId, input.credentialId),
    ));
    if (!input.models.length) return;
    await tx.insert(modelCatalog).values(input.models.map((model) => ({
      organizationId: input.organizationId,
      providerCredentialId: input.credentialId,
      model,
      capabilities: inferModelCapabilities(input.provider, model),
      freeTierEligible: isFreeTierModel(model),
      latencyMs: input.latencyMs,
      available: true,
      lastSeenAt: now,
    }))).onConflictDoUpdate({
      target: [modelCatalog.providerCredentialId, modelCatalog.model],
      set: { available: true, latencyMs: input.latencyMs, lastSeenAt: now, updatedAt: now },
    });
  });
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "providers:read");
    const rows = await db().select(publicProviderSelection)
      .from(providerCredentials)
      .where(and(eq(providerCredentials.organizationId, principal.organizationId), activeProvider));
    return apiSuccess({ credentials: rows.map(publicProvider) }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/provider-credentials");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "providers:write");
    const body = await parseJson(request, providerInputSchema, 24 * 1024);
    const preset = requestedPreset(body.provider, body.providerSlug);
    const requestedBaseUrl = body.baseUrl || preset.defaultBaseUrl || defaultBaseUrl(body.provider, preset.slug);
    if (!requestedBaseUrl) throw new ApiError(400, "BASE_URL_REQUIRED", "يلزم Base URL للمزود المتوافق.");
    const testModel = body.testModel ?? body.manualModel;
    if (!testModel) throw new ApiError(400, "MODEL_TEST_REQUIRED", "يلزم نموذج لإجراء اختبار توليد حقيقي.");
    const discovery = await validateProvider({
      ...body,
      providerSlug: preset.slug,
      baseUrl: requestedBaseUrl,
      testModel,
      requestId,
      signal: request.signal,
    });
    const encryptedSecret = encryptSecret(body.apiKey);
    const [created] = await db().insert(providerCredentials).values({
      organizationId: principal.organizationId,
      provider: body.provider,
      name: body.name,
      baseUrl: discovery.normalizedBaseUrl,
      encryptedSecret,
      secretHint: maskSecret(body.apiKey),
      discoveredModels: discovery.models,
      validationStatus: "verified",
      lastValidatedAt: new Date(),
      lastValidationLatencyMs: discovery.latencyMs,
      enabled: true,
    }).returning(publicProviderSelection);
    if (!created) throw new Error("PROVIDER_CREATE_FAILED");
    await replaceModels({
      organizationId: principal.organizationId,
      credentialId: created.id,
      provider: created.provider,
      models: discovery.models,
      latencyMs: discovery.latencyMs,
    });
    await db().insert(auditLogs).values({
      organizationId: principal.organizationId,
      actorType: "api_key",
      actorId: principal.apiKeyId,
      action: "provider_credential.created",
      resourceType: "provider_credential",
      resourceId: created.id,
      metadata: {
        provider: created.provider,
        providerSlug: discovery.providerSlug,
        modelCount: discovery.models.length,
        requestId,
      },
    });
    return apiSuccess({ credential: publicProvider(created) }, requestId, 201, {
      latencyMs: discovery.latencyMs,
      modelTest: discovery.modelTest,
    });
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/provider-credentials");
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "providers:write");
    const body = await parseJson(request, providerUpdateSchema, 24 * 1024);
    const [current] = await db().select().from(providerCredentials).where(and(
      eq(providerCredentials.id, body.id),
      eq(providerCredentials.organizationId, principal.organizationId),
      activeProvider,
    )).limit(1);
    if (!current) throw new ApiError(404, "PROVIDER_NOT_FOUND", "اتصال المزود غير موجود.");

    const currentSlug = inferProviderSlug(current.provider, current.baseUrl);
    const preset = requestedPreset(current.provider, body.providerSlug ?? currentSlug);
    const nextBaseUrl = body.baseUrl ?? (body.providerSlug && body.providerSlug !== currentSlug
      ? preset.defaultBaseUrl
      : current.baseUrl);
    if (!nextBaseUrl) throw new ApiError(400, "BASE_URL_REQUIRED", "يلزم Base URL صالح.");
    const connectionChanged = body.revalidate === true
      || Boolean(body.apiKey)
      || Boolean(body.manualModel)
      || preset.slug !== currentSlug
      || nextBaseUrl.replace(/\/+$/, "") !== current.baseUrl.replace(/\/+$/, "");

    let discovery: Awaited<ReturnType<typeof validateProvider>> | undefined;
    let apiKey: string | undefined;
    if (connectionChanged) {
      apiKey = body.apiKey ?? decryptSecret(current.encryptedSecret);
      const testModel = body.testModel ?? body.manualModel ?? current.discoveredModels[0];
      if (!testModel) throw new ApiError(400, "MODEL_TEST_REQUIRED", "يلزم نموذج اختبار.");
      discovery = await validateProvider({
        provider: current.provider,
        providerSlug: preset.slug,
        apiKey,
        baseUrl: nextBaseUrl,
        manualModel: body.manualModel,
        testModel,
        requestId,
        signal: request.signal,
      });
    }

    if (body.enabled === true && current.validationStatus !== "verified" && !discovery) {
      throw new ApiError(409, "PROVIDER_NOT_VERIFIED", "أعد فحص المزود قبل تفعيله.");
    }
    const [updated] = await db().update(providerCredentials).set({
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      ...(discovery ? {
        baseUrl: discovery.normalizedBaseUrl,
        discoveredModels: discovery.models,
        validationStatus: "verified" as const,
        lastValidatedAt: new Date(),
        lastValidationLatencyMs: discovery.latencyMs,
        lastErrorCode: null,
        consecutiveFailures: 0,
        circuitOpenUntil: null,
        enabled: body.enabled ?? true,
      } : {}),
      ...(body.apiKey && apiKey ? {
        encryptedSecret: encryptSecret(apiKey),
        secretHint: maskSecret(apiKey),
      } : {}),
      updatedAt: new Date(),
    }).where(and(
      eq(providerCredentials.id, current.id),
      eq(providerCredentials.organizationId, principal.organizationId),
      activeProvider,
    )).returning(publicProviderSelection);
    if (!updated) throw new ApiError(404, "PROVIDER_NOT_FOUND", "اتصال المزود غير موجود.");
    if (discovery) {
      await replaceModels({
        organizationId: principal.organizationId,
        credentialId: updated.id,
        provider: updated.provider,
        models: discovery.models,
        latencyMs: discovery.latencyMs,
      });
    }
    await db().insert(auditLogs).values({
      organizationId: principal.organizationId,
      actorType: "api_key",
      actorId: principal.apiKeyId,
      action: discovery ? "provider_credential.revalidated" : "provider_credential.updated",
      resourceType: "provider_credential",
      resourceId: updated.id,
      metadata: { enabled: updated.enabled, requestId },
    });
    return apiSuccess({ credential: publicProvider(updated) }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/provider-credentials");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "providers:write");
    const body = await parseJson(request, providerDeleteSchema, 4 * 1024);
    const [current] = await db().select({ id: providerCredentials.id, name: providerCredentials.name })
      .from(providerCredentials).where(and(
        eq(providerCredentials.id, body.id),
        eq(providerCredentials.organizationId, principal.organizationId),
        activeProvider,
      )).limit(1);
    if (!current) throw new ApiError(404, "PROVIDER_NOT_FOUND", "اتصال المزود غير موجود.");
    const now = new Date();
    await db().transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE "provider_credentials"
        SET "deleted_at" = ${now},
            "enabled" = false,
            "last_error_code" = 'PROVIDER_DELETED',
            "updated_at" = ${now}
        WHERE "id" = ${current.id}
          AND "organization_id" = ${principal.organizationId}
          AND "deleted_at" IS NULL
      `);
      await tx.update(modelCatalog).set({ available: false, updatedAt: now }).where(and(
        eq(modelCatalog.organizationId, principal.organizationId),
        eq(modelCatalog.providerCredentialId, current.id),
      ));
      await tx.update(organizations).set({
        defaultProviderCredentialId: null,
        defaultModel: null,
        updatedAt: now,
      }).where(and(
        eq(organizations.id, principal.organizationId),
        eq(organizations.defaultProviderCredentialId, current.id),
      ));
      await tx.update(agents).set({
        defaultProviderCredentialId: null,
        defaultModel: null,
        updatedAt: now,
      }).where(and(
        eq(agents.organizationId, principal.organizationId),
        eq(agents.defaultProviderCredentialId, current.id),
      ));
      await tx.insert(auditLogs).values({
        organizationId: principal.organizationId,
        actorType: "api_key",
        actorId: principal.apiKeyId,
        action: "provider_credential.deleted",
        resourceType: "provider_credential",
        resourceId: current.id,
        metadata: { name: current.name, softDelete: true, requestId },
      });
    });
    return apiSuccess({ deleted: true, id: current.id }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/provider-credentials");
  }
}
