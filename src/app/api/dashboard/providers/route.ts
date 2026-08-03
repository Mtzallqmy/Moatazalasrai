import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, auditLogs, modelCatalog, organizations, providerCredentials } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { encryptSecret, maskSecret } from "@/lib/security/encryption";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { paginationSchema, providerDeleteSchema, providerInputSchema, providerUpdateSchema } from "@/lib/http/contracts";
import { getProviderPreset, resolveProviderPreset } from "@/lib/providers/catalog";
import { healthStatusForProviderError, normalizeUnknownProviderError } from "@/lib/providers/errors";
import {
  asCredentialMode,
  asProviderTypeId,
  asTransportMode,
  defaultProviderTypeId,
  resolveProviderApiKey,
} from "@/lib/providers/provider-config";
import { providerRegistry } from "@/lib/providers/platform-registry";
import { providerCapabilitiesRecord } from "@/lib/providers/types";
import { defaultBaseUrl, inferProviderSlug, validateProvider } from "@/lib/providers/registry";
import { ProviderError, type ProviderKind } from "@/lib/providers/types";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { inferModelCapabilities, isFreeTierModel } from "@/server/models/capabilities";

export const runtime = "nodejs";

const activeProvider = sql`"provider_credentials"."deleted_at" IS NULL`;

const publicSelection = {
  id: providerCredentials.id,
  provider: providerCredentials.provider,
  providerTypeId: providerCredentials.providerTypeId,
  transportMode: providerCredentials.transportMode,
  credentialMode: providerCredentials.credentialMode,
  name: providerCredentials.name,
  baseUrl: providerCredentials.baseUrl,
  gatewayId: providerCredentials.gatewayId,
  keyAlias: providerCredentials.keyAlias,
  gatewaySkipCache: providerCredentials.gatewaySkipCache,
  gatewayCacheTtl: providerCredentials.gatewayCacheTtl,
  gatewayCollectLog: providerCredentials.gatewayCollectLog,
  defaultModel: providerCredentials.defaultModel,
  allowedModels: providerCredentials.allowedModels,
  capabilities: providerCredentials.capabilities,
  secretHint: providerCredentials.secretHint,
  discoveredModels: providerCredentials.discoveredModels,
  validationStatus: providerCredentials.validationStatus,
  healthStatus: providerCredentials.healthStatus,
  lastValidatedAt: providerCredentials.lastValidatedAt,
  lastCheckedAt: providerCredentials.lastCheckedAt,
  lastSuccessfulAt: providerCredentials.lastSuccessfulAt,
  lastFailureAt: providerCredentials.lastFailureAt,
  lastValidationLatencyMs: providerCredentials.lastValidationLatencyMs,
  lastErrorCode: providerCredentials.lastErrorCode,
  lastErrorCategory: providerCredentials.lastErrorCategory,
  consecutiveFailures: providerCredentials.consecutiveFailures,
  circuitOpenUntil: providerCredentials.circuitOpenUntil,
  enabled: providerCredentials.enabled,
  isDefault: providerCredentials.isDefault,
  createdAt: providerCredentials.createdAt,
  updatedAt: providerCredentials.updatedAt,
};

type PublicProvider = typeof providerCredentials.$inferSelect;

type PublicProviderRow = Pick<PublicProvider,
  "id" | "provider" | "providerTypeId" | "transportMode" | "credentialMode" | "name" | "baseUrl" |
  "gatewayId" | "keyAlias" | "gatewaySkipCache" | "gatewayCacheTtl" | "gatewayCollectLog" | "defaultModel" | "allowedModels" | "capabilities" | "secretHint" |
  "discoveredModels" | "validationStatus" | "healthStatus" | "lastValidatedAt" | "lastCheckedAt" |
  "lastSuccessfulAt" | "lastFailureAt" | "lastValidationLatencyMs" | "lastErrorCode" | "lastErrorCategory" |
  "consecutiveFailures" | "circuitOpenUntil" | "enabled" | "isDefault" | "createdAt" | "updatedAt"
>;

function publicProvider(row: PublicProviderRow) {
  const providerTypeId = asProviderTypeId(row.providerTypeId, row.provider);
  const providerSlug = providerTypeId === "cloudflare-workers-ai"
    ? "cloudflare-workers-ai"
    : providerTypeId === "cloudflare-ai-gateway"
      ? "cloudflare-ai-gateway"
      : inferProviderSlug(row.provider, row.baseUrl);
  const preset = getProviderPreset(providerSlug);
  return {
    ...row,
    providerTypeId,
    providerSlug,
    providerLabel: providerTypeId === "cloudflare-workers-ai"
      ? "Cloudflare Workers AI"
      : providerTypeId === "cloudflare-ai-gateway"
        ? "Cloudflare AI Gateway"
        : preset?.labelAr ?? preset?.label ?? providerSlug,
    apiStyle: row.transportMode === "cloudflare_workers_ai"
      ? "workers_ai_binding"
      : row.transportMode === "cloudflare_ai_gateway_rest"
        ? "cloudflare_rest_chat"
        : preset?.apiStyle ?? "openai_chat",
  };
}

function requestedPreset(provider: ProviderKind, slug?: string) {
  if (!slug) return resolveProviderPreset({ provider });
  const preset = getProviderPreset(slug);
  if (!preset || preset.provider !== provider) {
    throw new ApiError(400, "PROVIDER_PRESET_INVALID", "نوع المزود لا يطابق الإعداد الجاهز المختار.");
  }
  return preset;
}

function mapProviderError(error: unknown): never {
  const normalized = normalizeUnknownProviderError(error);
  throw new ApiError(normalized.httpStatus, normalized.code, normalized.message, normalized.diagnostic());
}

function configuredBaseUrl(input: {
  provider: ProviderKind;
  providerSlug?: string;
  baseUrl?: string;
  transportMode: string;
}) {
  if (input.transportMode === "cloudflare_workers_ai") return "cloudflare:workers-ai";
  if (input.transportMode === "cloudflare_ai_gateway_rest") {
    return input.baseUrl ?? "https://api.cloudflare.com/client/v4/accounts/managed/ai/v1";
  }
  const preset = requestedPreset(input.provider, input.providerSlug);
  return input.baseUrl || preset.defaultBaseUrl || defaultBaseUrl(input.provider, preset.slug);
}

async function syncModelCatalog(input: {
  organizationId: string;
  providerCredentialId: string;
  provider: ProviderKind;
  models: string[];
  latencyMs: number;
}) {
  const now = new Date();
  await db().transaction(async (tx) => {
    await tx.update(modelCatalog).set({ available: false, updatedAt: now }).where(and(
      eq(modelCatalog.organizationId, input.organizationId),
      eq(modelCatalog.providerCredentialId, input.providerCredentialId),
    ));
    if (!input.models.length) return;
    await tx.insert(modelCatalog).values(input.models.map((model) => ({
      organizationId: input.organizationId,
      providerCredentialId: input.providerCredentialId,
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
    const session = await requireSession("providers:read");
    const query = paginationSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const where = and(eq(providerCredentials.organizationId, session.organizationId), activeProvider);
    const [rows, totalRows] = await Promise.all([
      db().select(publicSelection).from(providerCredentials).where(where)
        .orderBy(desc(providerCredentials.isDefault), desc(providerCredentials.createdAt))
        .limit(query.limit).offset((query.page - 1) * query.limit),
      db().select({ value: count() }).from(providerCredentials).where(where),
    ]);
    const total = totalRows[0]?.value ?? 0;
    return apiSuccess(rows.map(publicProvider), requestId, 200, {
      pagination: { ...query, total, pages: Math.ceil(total / query.limit) },
    });
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/providers");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("providers:manage");
    await enforceRateLimit({ scope: "provider.create", key: `${session.organizationId}:${session.userId}`, limit: 12, windowMs: 10 * 60_000 });
    const body = await parseJson(request, providerInputSchema, 40 * 1024);
    const providerTypeId = body.providerTypeId ?? defaultProviderTypeId(body.provider);
    const baseUrl = configuredBaseUrl(body);
    if (!baseUrl) throw new ApiError(400, "BASE_URL_REQUIRED", "أدخل Base URL للمزود المتوافق.");
    const testModel = body.testModel ?? body.defaultModel ?? body.manualModel;
    if (!testModel) throw new ApiError(400, "MODEL_TEST_REQUIRED", "اختر نموذجًا لإجراء اختبار اتصال حقيقي.");

    let validation: Awaited<ReturnType<typeof validateProvider>> | undefined;
    let validationError: ProviderError | undefined;
    try {
      validation = await validateProvider({
        ...body,
        providerTypeId,
        baseUrl,
        testModel,
        requestId,
        organizationId: session.organizationId,
        signal: request.signal,
      });
    } catch (error) {
      validationError = normalizeUnknownProviderError(error, { provider: providerTypeId, model: testModel, requestId });
      if (!body.saveInvalid) mapProviderError(validationError);
    }

    if (body.isDefault && !validation) {
      throw new ApiError(409, "INVALID_PROVIDER_CANNOT_BE_DEFAULT", "لا يمكن جعل اتصال فاشل التحقق مزودًا افتراضيًا.");
    }

    const now = new Date();
    const capabilities = providerCapabilitiesRecord(providerRegistry.get(providerTypeId).getCapabilities());
    const encryptedSecret = body.credentialMode === "encrypted_byok" && body.apiKey
      ? encryptSecret(body.apiKey, `provider:${session.organizationId}`)
      : null;
    const secretHint = body.credentialMode === "encrypted_byok" && body.apiKey
      ? maskSecret(body.apiKey)
      : body.credentialMode === "cloudflare_provider_key"
        ? `Cloudflare alias: ${body.keyAlias}`
        : "Cloudflare managed secret";
    const models = validation?.models ?? [...new Set([testModel, ...body.allowedModels])];

    const created = await db().transaction(async (tx) => {
      if (body.isDefault) {
        await tx.update(providerCredentials).set({ isDefault: false, updatedAt: now }).where(and(
          eq(providerCredentials.organizationId, session.organizationId),
          eq(providerCredentials.isDefault, true),
        ));
      }
      const [credential] = await tx.insert(providerCredentials).values({
        organizationId: session.organizationId,
        provider: body.provider,
        providerTypeId,
        transportMode: body.transportMode,
        credentialMode: body.credentialMode,
        name: body.name,
        baseUrl: validation?.normalizedBaseUrl ?? baseUrl,
        encryptedSecret,
        secretHint,
        gatewayId: body.gatewayId,
        keyAlias: body.keyAlias,
        gatewaySkipCache: body.skipCache,
        gatewayCacheTtl: body.cacheTtl,
        gatewayCollectLog: body.collectLog,
        defaultModel: body.defaultModel ?? testModel,
        allowedModels: [...new Set([...body.allowedModels, ...models])],
        capabilities,
        discoveredModels: models,
        validationStatus: validation ? "verified" : "failed",
        healthStatus: validation ? "healthy" : healthStatusForProviderError(validationError!),
        lastValidatedAt: validation ? now : null,
        lastCheckedAt: now,
        lastSuccessfulAt: validation ? now : null,
        lastFailureAt: validation ? null : now,
        lastValidationLatencyMs: validation?.latencyMs,
        lastErrorCode: validationError?.code ?? null,
        lastErrorCategory: validationError?.category ?? null,
        consecutiveFailures: validation ? 0 : 1,
        enabled: Boolean(validation),
        isDefault: body.isDefault,
      }).returning(publicSelection);
      if (!credential) throw new Error("PROVIDER_CREATE_FAILED");
      if (body.isDefault) {
        await tx.update(organizations).set({
          defaultProviderCredentialId: credential.id,
          defaultModel: credential.defaultModel,
          updatedAt: now,
        }).where(eq(organizations.id, session.organizationId));
      }
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: validation ? "provider.created" : "provider.created_invalid",
        resourceType: "provider_credential",
        resourceId: credential.id,
        metadata: {
          provider: credential.provider,
          providerTypeId,
          transportMode: body.transportMode,
          credentialMode: body.credentialMode,
          keyAlias: body.keyAlias,
          modelCount: models.length,
          testedModel: testModel,
          validationErrorCode: validationError?.code,
          requestId,
        },
      });
      const [verified] = await tx.select(publicSelection).from(providerCredentials).where(and(
        eq(providerCredentials.id, credential.id),
        eq(providerCredentials.organizationId, session.organizationId),
      )).limit(1);
      if (!verified || verified.providerTypeId !== providerTypeId) throw new Error("PROVIDER_SAVE_VERIFICATION_FAILED");
      return verified;
    });

    if (validation) await syncModelCatalog({
      organizationId: session.organizationId,
      providerCredentialId: created.id,
      provider: created.provider,
      models: validation.models,
      latencyMs: validation.latencyMs,
    });
    return apiSuccess(publicProvider(created), requestId, 201, {
      latencyMs: validation?.latencyMs,
      stages: validation?.stages,
      modelTest: validation?.modelTest,
      validationError: validationError?.diagnostic(),
    });
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/providers");
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("providers:manage");
    const body = await parseJson(request, providerUpdateSchema, 40 * 1024);
    const [current] = await db().select().from(providerCredentials).where(and(
      eq(providerCredentials.id, body.id),
      eq(providerCredentials.organizationId, session.organizationId),
      activeProvider,
    )).limit(1);
    if (!current) throw new ApiError(404, "PROVIDER_NOT_FOUND", "اتصال المزود غير موجود.");

    const providerTypeId = body.providerTypeId ?? asProviderTypeId(current.providerTypeId, current.provider);
    const transportMode = body.transportMode ?? asTransportMode(current.transportMode);
    const credentialMode = body.credentialMode ?? asCredentialMode(current.credentialMode);
    const currentSlug = inferProviderSlug(current.provider, current.baseUrl);
    const providerSlug = body.providerSlug ?? currentSlug;
    const baseUrl = configuredBaseUrl({ provider: current.provider, providerSlug, baseUrl: body.baseUrl ?? current.baseUrl, transportMode });
    if (!baseUrl) throw new ApiError(400, "BASE_URL_REQUIRED", "أدخل Base URL صالحًا.");
    const gatewayId = body.gatewayId === undefined ? current.gatewayId ?? undefined : body.gatewayId ?? undefined;
    const keyAlias = body.keyAlias === undefined ? current.keyAlias ?? undefined : body.keyAlias ?? undefined;
    const allowedModels = body.allowedModels ?? current.allowedModels;
    const defaultModel = body.defaultModel === undefined ? current.defaultModel ?? undefined : body.defaultModel ?? undefined;
    const connectionChanged = body.revalidate === true
      || body.apiKey !== undefined
      || body.transportMode !== undefined
      || body.credentialMode !== undefined
      || body.gatewayId !== undefined
      || body.keyAlias !== undefined
      || body.baseUrl !== undefined
      || body.providerSlug !== undefined;

    if (body.enabled === true && current.validationStatus !== "verified" && !connectionChanged) {
      throw new ApiError(409, "PROVIDER_NOT_VERIFIED", "أعد فحص المزود قبل تفعيله.");
    }

    let validation: Awaited<ReturnType<typeof validateProvider>> | undefined;
    let resolvedApiKey = body.apiKey;
    if (connectionChanged) {
      await enforceRateLimit({ scope: "provider.update.validate", key: `${session.organizationId}:${session.userId}`, limit: 16, windowMs: 10 * 60_000 });
      if (credentialMode === "encrypted_byok" && !resolvedApiKey) {
        resolvedApiKey = resolveProviderApiKey({
          provider: current.provider,
          providerTypeId,
          transportMode,
          credentialMode,
          encryptedSecret: current.encryptedSecret,
          baseUrl: current.baseUrl,
          gatewayId: current.gatewayId,
          keyAlias: current.keyAlias,
        }, session.organizationId);
      }
      const testModel = body.testModel ?? body.manualModel ?? defaultModel ?? current.discoveredModels[0];
      if (!testModel) throw new ApiError(400, "MODEL_TEST_REQUIRED", "اختر نموذج اختبار قبل إعادة الفحص.");
      try {
        validation = await validateProvider({
          provider: current.provider,
          providerTypeId,
          providerSlug,
          apiKey: resolvedApiKey,
          baseUrl,
          transportMode,
          credentialMode,
          gatewayId,
          keyAlias,
          allowedModels,
          defaultModel,
          testModel,
          manualModel: body.manualModel,
          skipCache: body.skipCache,
          cacheTtl: body.cacheTtl ?? undefined,
          collectLog: body.collectLog,
          requestId,
          organizationId: session.organizationId,
          signal: request.signal,
        });
      } catch (error) {
        mapProviderError(error);
      }
    }

    const now = new Date();
    const [updated] = await db().transaction(async (tx) => {
      if (body.isDefault === true) {
        await tx.update(providerCredentials).set({ isDefault: false, updatedAt: now }).where(and(
          eq(providerCredentials.organizationId, session.organizationId),
          eq(providerCredentials.isDefault, true),
        ));
      }
      const nextModels = validation?.models ?? current.discoveredModels;
      const [row] = await tx.update(providerCredentials).set({
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.enabled === undefined ? {} : { enabled: body.enabled, healthStatus: body.enabled ? current.healthStatus : "disabled" }),
        ...(body.isDefault === undefined ? {} : { isDefault: body.isDefault }),
        ...(body.defaultModel === undefined ? {} : { defaultModel: body.defaultModel }),
        ...(body.allowedModels === undefined ? {} : { allowedModels: body.allowedModels }),
        ...(validation ? {
          providerTypeId,
          transportMode,
          credentialMode,
          gatewayId,
          keyAlias,
          gatewaySkipCache: body.skipCache ?? current.gatewaySkipCache,
          gatewayCacheTtl: body.cacheTtl === undefined ? current.gatewayCacheTtl : body.cacheTtl,
          gatewayCollectLog: body.collectLog ?? current.gatewayCollectLog,
          baseUrl: validation.normalizedBaseUrl,
          defaultModel: defaultModel ?? validation.modelTest?.model,
          allowedModels: [...new Set([...allowedModels, ...validation.models])],
          capabilities: providerCapabilitiesRecord(providerRegistry.get(providerTypeId).getCapabilities()),
          discoveredModels: validation.models,
          validationStatus: "verified" as const,
          healthStatus: "healthy",
          lastValidatedAt: now,
          lastCheckedAt: now,
          lastSuccessfulAt: now,
          lastFailureAt: null,
          lastValidationLatencyMs: validation.latencyMs,
          lastErrorCode: null,
          lastErrorCategory: null,
          consecutiveFailures: 0,
          circuitOpenUntil: null,
          enabled: body.enabled ?? true,
        } : {}),
        ...(credentialMode === "encrypted_byok" && body.apiKey ? {
          encryptedSecret: encryptSecret(body.apiKey, `provider:${session.organizationId}`),
          secretHint: maskSecret(body.apiKey),
        } : validation && credentialMode !== "encrypted_byok" ? {
          encryptedSecret: null,
          secretHint: credentialMode === "cloudflare_provider_key" ? `Cloudflare alias: ${keyAlias}` : "Cloudflare managed secret",
        } : {}),
        updatedAt: now,
      }).where(and(
        eq(providerCredentials.id, current.id),
        eq(providerCredentials.organizationId, session.organizationId),
        activeProvider,
      )).returning(publicSelection);
      if (!row) throw new ApiError(404, "PROVIDER_NOT_FOUND", "اتصال المزود غير موجود.");

      if (body.isDefault === true) {
        await tx.update(organizations).set({ defaultProviderCredentialId: row.id, defaultModel: row.defaultModel, updatedAt: now })
          .where(eq(organizations.id, session.organizationId));
      } else if (body.isDefault === false && current.isDefault) {
        await tx.update(organizations).set({ defaultProviderCredentialId: null, defaultModel: null, updatedAt: now })
          .where(and(eq(organizations.id, session.organizationId), eq(organizations.defaultProviderCredentialId, current.id)));
      }

      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: validation ? "provider.revalidated" : "provider.updated",
        resourceType: "provider_credential",
        resourceId: row.id,
        metadata: {
          enabled: row.enabled,
          isDefault: row.isDefault,
          providerTypeId: row.providerTypeId,
          transportMode: row.transportMode,
          credentialMode: row.credentialMode,
          modelCount: nextModels.length,
          requestId,
        },
      });
      return [row];
    });

    if (validation) await syncModelCatalog({
      organizationId: session.organizationId,
      providerCredentialId: updated.id,
      provider: updated.provider,
      models: validation.models,
      latencyMs: validation.latencyMs,
    });
    return apiSuccess(publicProvider(updated), requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/providers");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("providers:manage");
    const body = await parseJson(request, providerDeleteSchema, 4 * 1024);
    const [current] = await db().select({ id: providerCredentials.id, name: providerCredentials.name, isDefault: providerCredentials.isDefault })
      .from(providerCredentials).where(and(
        eq(providerCredentials.id, body.id),
        eq(providerCredentials.organizationId, session.organizationId),
        activeProvider,
      )).limit(1);
    if (!current) throw new ApiError(404, "PROVIDER_NOT_FOUND", "اتصال المزود غير موجود.");

    const now = new Date();
    await db().transaction(async (tx) => {
      await tx.update(providerCredentials).set({
        deletedAt: now,
        enabled: false,
        isDefault: false,
        healthStatus: "disabled",
        lastErrorCode: "PROVIDER_DELETED",
        circuitOpenUntil: null,
        updatedAt: now,
      }).where(and(
        eq(providerCredentials.id, current.id),
        eq(providerCredentials.organizationId, session.organizationId),
        activeProvider,
      ));
      await tx.update(modelCatalog).set({ available: false, updatedAt: now }).where(and(
        eq(modelCatalog.organizationId, session.organizationId),
        eq(modelCatalog.providerCredentialId, current.id),
      ));
      await tx.update(organizations).set({ defaultProviderCredentialId: null, defaultModel: null, updatedAt: now }).where(and(
        eq(organizations.id, session.organizationId),
        eq(organizations.defaultProviderCredentialId, current.id),
      ));
      await tx.update(agents).set({ defaultProviderCredentialId: null, defaultModel: null, updatedAt: now }).where(and(
        eq(agents.organizationId, session.organizationId),
        eq(agents.defaultProviderCredentialId, current.id),
      ));
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "provider.deleted",
        resourceType: "provider_credential",
        resourceId: current.id,
        metadata: { name: current.name, softDelete: true, wasDefault: current.isDefault, requestId },
      });
    });
    return apiSuccess({ deleted: true, id: current.id }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/providers");
  }
}
