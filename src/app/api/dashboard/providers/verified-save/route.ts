import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { providerValidationSessions } from "@/db/provider-validation-schema";
import { auditLogs, modelCatalog, providerCredentials } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { providerInputSchema, uuidSchema } from "@/lib/http/contracts";
import { getProviderPreset } from "@/lib/providers/catalog";
import { providerValidationMatches } from "@/lib/providers/validation-session";
import { encryptSecret, maskSecret } from "@/lib/security/encryption";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { inferModelCapabilities, isFreeTierModel } from "@/server/models/capabilities";

export const runtime = "nodejs";

const verifiedSaveSchema = providerInputSchema.extend({
  validationId: uuidSchema,
}).strict();

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
    const body = await parseJson(request, verifiedSaveSchema, 32 * 1024);
    const testModel = body.testModel ?? body.manualModel;
    if (!testModel) {
      throw new ApiError(400, "MODEL_TEST_REQUIRED", "اختر نموذج الاختبار الذي نجح قبل الحفظ.");
    }

    const now = new Date();
    const created = await db().transaction(async (tx) => {
      const [validation] = await tx.select().from(providerValidationSessions).where(and(
        eq(providerValidationSessions.id, body.validationId),
        eq(providerValidationSessions.organizationId, session.organizationId),
        eq(providerValidationSessions.userId, session.userId),
        isNull(providerValidationSessions.consumedAt),
        gt(providerValidationSessions.expiresAt, now),
      )).limit(1);
      if (!validation) {
        throw new ApiError(409, "PROVIDER_VALIDATION_EXPIRED", "انتهت صلاحية فحص المزود أو استُخدم سابقًا. أعد اختبار النموذج ثم احفظ.");
      }

      const providerSlug = body.providerSlug ?? validation.providerSlug;
      const baseUrl = body.baseUrl ?? validation.normalizedBaseUrl;
      if (!providerValidationMatches(validation, {
        provider: body.provider,
        providerSlug,
        baseUrl,
        apiKey: body.apiKey,
        testModel,
      })) {
        throw new ApiError(409, "PROVIDER_VALIDATION_STALE", "تغير المفتاح أو المزود أو النموذج بعد الفحص. أعد اختبار الاتصال قبل الحفظ.");
      }
      if (validation.models.length === 0 || !validation.models.includes(testModel)) {
        throw new ApiError(409, "PROVIDER_VALIDATION_INVALID", "نتيجة فحص المزود لا تحتوي النموذج المختبر.");
      }

      const [consumed] = await tx.update(providerValidationSessions).set({ consumedAt: now }).where(and(
        eq(providerValidationSessions.id, validation.id),
        eq(providerValidationSessions.organizationId, session.organizationId),
        eq(providerValidationSessions.userId, session.userId),
        isNull(providerValidationSessions.consumedAt),
        gt(providerValidationSessions.expiresAt, now),
      )).returning({ id: providerValidationSessions.id });
      if (!consumed) {
        throw new ApiError(409, "PROVIDER_VALIDATION_CONSUMED", "استُخدمت نتيجة الفحص بالفعل. أعد الفحص لإنشاء اتصال آخر.");
      }

      const [credential] = await tx.insert(providerCredentials).values({
        organizationId: session.organizationId,
        provider: body.provider,
        name: body.name,
        baseUrl: validation.normalizedBaseUrl,
        encryptedSecret: encryptSecret(body.apiKey, `provider:${session.organizationId}`),
        secretHint: maskSecret(body.apiKey),
        discoveredModels: validation.models,
        validationStatus: "verified",
        lastValidatedAt: now,
        lastValidationLatencyMs: validation.latencyMs,
        lastErrorCode: null,
        consecutiveFailures: 0,
        circuitOpenUntil: null,
        enabled: true,
      }).returning({
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
      });
      if (!credential) throw new Error("PROVIDER_CREATE_FAILED");

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

      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "provider.created",
        resourceType: "provider_credential",
        resourceId: credential.id,
        metadata: {
          provider: credential.provider,
          providerSlug,
          testedModel: testModel,
          modelCount: validation.models.length,
          validationId: validation.id,
          atomicSave: true,
          requestId,
        },
      });
      return credential;
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
