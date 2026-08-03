import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { providerValidationSessions } from "@/db/provider-validation-schema";
import { auditLogs, modelCatalog, organizations, providerCredentials } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { providerVerifiedSaveSchema } from "@/lib/http/contracts";
import { getProviderPreset } from "@/lib/providers/catalog";
import { defaultProviderTypeId } from "@/lib/providers/provider-config";
import { providerRegistry } from "@/lib/providers/platform-registry";
import { providerValidationMatches } from "@/lib/providers/validation-session";
import { encryptSecret, maskSecret } from "@/lib/security/encryption";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { inferModelCapabilities, isFreeTierModel } from "@/server/models/capabilities";
import { providerCapabilitiesRecord } from "@/lib/providers/types";

export const runtime = "nodejs";


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

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("providers:manage");
    await enforceRateLimit({
      scope: "provider.verified-save",
      key: `${session.organizationId}:${session.userId}`,
      limit: 12,
      windowMs: 10 * 60_000,
    });
    const body = await parseJson(request, providerVerifiedSaveSchema, 40 * 1024);
    const testModel = body.testModel ?? body.defaultModel ?? body.manualModel;
    if (!testModel) throw new ApiError(400, "MODEL_TEST_REQUIRED", "اختر نموذج الاختبار الذي نجح قبل الحفظ.");

    const now = new Date();
    const created = await db().transaction(async (tx) => {
      const [validation] = await tx.select().from(providerValidationSessions).where(and(
        eq(providerValidationSessions.id, body.validationId),
        eq(providerValidationSessions.organizationId, session.organizationId),
        eq(providerValidationSessions.userId, session.userId),
        isNull(providerValidationSessions.consumedAt),
        gt(providerValidationSessions.expiresAt, now),
      )).limit(1);
      if (!validation) throw new ApiError(409, "PROVIDER_VALIDATION_EXPIRED", "انتهت صلاحية فحص المزود أو استُخدم سابقًا. أعد الاختبار ثم احفظ.");

      const providerTypeId = body.providerTypeId ?? defaultProviderTypeId(body.provider);
      const providerSlug = body.providerSlug ?? validation.providerSlug;
      const baseUrl = body.baseUrl ?? validation.normalizedBaseUrl;
      if (!providerValidationMatches(validation, {
        provider: body.provider,
        providerTypeId,
        providerSlug,
        transportMode: body.transportMode,
        credentialMode: body.credentialMode,
        gatewayId: body.gatewayId,
        keyAlias: body.keyAlias,
        baseUrl,
        apiKey: body.apiKey,
        testModel,
        allowedModels: body.allowedModels,
        skipCache: body.skipCache,
        cacheTtl: body.cacheTtl,
        collectLog: body.collectLog,
      })) {
        throw new ApiError(409, "PROVIDER_VALIDATION_STALE", "تغير إعداد المزود أو النموذج بعد الفحص. أعد الاختبار قبل الحفظ.");
      }
      if (!validation.models.includes(testModel)) throw new ApiError(409, "PROVIDER_VALIDATION_INVALID", "نتيجة الفحص لا تحتوي النموذج المختبر.");

      const [consumed] = await tx.update(providerValidationSessions).set({ consumedAt: now }).where(and(
        eq(providerValidationSessions.id, validation.id),
        isNull(providerValidationSessions.consumedAt),
        gt(providerValidationSessions.expiresAt, now),
      )).returning({ id: providerValidationSessions.id });
      if (!consumed) throw new ApiError(409, "PROVIDER_VALIDATION_CONSUMED", "استُخدمت نتيجة الفحص بالفعل.");

      if (body.isDefault) {
        await tx.update(providerCredentials).set({ isDefault: false, updatedAt: now }).where(and(
          eq(providerCredentials.organizationId, session.organizationId),
          eq(providerCredentials.isDefault, true),
        ));
      }

      const capabilities = providerCapabilitiesRecord(providerRegistry.get(providerTypeId).getCapabilities());
      const encryptedSecret = body.credentialMode === "encrypted_byok" && body.apiKey
        ? encryptSecret(body.apiKey, `provider:${session.organizationId}`)
        : null;
      const secretHint = body.credentialMode === "encrypted_byok" && body.apiKey
        ? maskSecret(body.apiKey)
        : body.credentialMode === "cloudflare_provider_key"
          ? `Cloudflare alias: ${body.keyAlias}`
          : "Cloudflare managed secret";
      const allowedModels = [...new Set([...body.allowedModels, ...validation.models])];
      const [credential] = await tx.insert(providerCredentials).values({
        organizationId: session.organizationId,
        provider: body.provider,
        providerTypeId,
        transportMode: body.transportMode,
        credentialMode: body.credentialMode,
        name: body.name,
        baseUrl: validation.normalizedBaseUrl,
        encryptedSecret,
        secretHint,
        gatewayId: body.gatewayId,
        keyAlias: body.keyAlias,
        gatewaySkipCache: body.skipCache,
        gatewayCacheTtl: body.cacheTtl,
        gatewayCollectLog: body.collectLog,
        defaultModel: body.defaultModel ?? testModel,
        allowedModels,
        capabilities,
        discoveredModels: validation.models,
        validationStatus: "verified",
        healthStatus: "healthy",
        lastValidatedAt: now,
        lastCheckedAt: now,
        lastSuccessfulAt: now,
        lastValidationLatencyMs: validation.latencyMs,
        lastErrorCode: null,
        lastErrorCategory: null,
        consecutiveFailures: 0,
        circuitOpenUntil: null,
        enabled: true,
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

      if (validation.models.length) {
        await tx.insert(modelCatalog).values(validation.models.map((model) => ({
          organizationId: session.organizationId,
          providerCredentialId: credential.id,
          model,
          capabilities: inferModelCapabilities(body.provider, model),
          freeTierEligible: isFreeTierModel(model),
          latencyMs: validation.latencyMs,
          available: true,
          lastSeenAt: now,
        })));
      }

      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "provider.created",
        resourceType: "provider_credential",
        resourceId: credential.id,
        metadata: {
          provider: credential.provider,
          providerTypeId,
          providerSlug,
          transportMode: body.transportMode,
          credentialMode: body.credentialMode,
          keyAlias: body.keyAlias,
          testedModel: testModel,
          modelCount: validation.models.length,
          validationId: validation.id,
          atomicSave: true,
          requestId,
        },
      });

      const [verified] = await tx.select(publicSelection).from(providerCredentials).where(and(
        eq(providerCredentials.id, credential.id),
        eq(providerCredentials.organizationId, session.organizationId),
      )).limit(1);
      if (!verified || verified.providerTypeId !== providerTypeId || verified.transportMode !== body.transportMode) {
        throw new Error("PROVIDER_SAVE_VERIFICATION_FAILED");
      }
      return verified;
    });

    const preset = getProviderPreset(body.providerSlug);
    return apiSuccess({
      ...created,
      providerSlug: body.providerSlug,
      providerLabel: preset?.labelAr ?? preset?.label ?? body.providerSlug ?? body.provider,
      testedModel: testModel,
    }, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/providers/verified-save");
  }
}
