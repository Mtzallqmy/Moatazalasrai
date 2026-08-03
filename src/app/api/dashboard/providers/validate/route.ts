import { z } from "zod";
import { db } from "@/db";
import { providerValidationSessions } from "@/db/provider-validation-schema";
import { auditLogs } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { providerValidationSchema } from "@/lib/http/contracts";
import { normalizeUnknownProviderError } from "@/lib/providers/errors";
import { defaultProviderTypeId } from "@/lib/providers/provider-config";
import { validateProvider } from "@/lib/providers/registry";
import {
  providerValidationConfigHash,
  providerValidationTtlSeconds,
} from "@/lib/providers/validation-session";
import { hashApiKey } from "@/lib/security/encryption";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const validationRequestSchema = providerValidationSchema.safeExtend({
  mode: z.enum(["discover", "verify"]).default("discover"),
}).strict();

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("providers:manage");
    await enforceRateLimit({
      scope: "provider.validate",
      key: `${session.organizationId}:${session.userId}`,
      limit: 18,
      windowMs: 10 * 60_000,
    });
    const body = await parseJson(request, validationRequestSchema, 32 * 1024);
    const { mode, ...providerInput } = body;
    const providerTypeId = providerInput.providerTypeId ?? defaultProviderTypeId(providerInput.provider);
    const testModel = providerInput.testModel ?? providerInput.defaultModel ?? providerInput.manualModel;
    if (mode === "verify" && !testModel) {
      throw new ApiError(400, "MODEL_TEST_REQUIRED", "اختر نموذجًا لإجراء اختبار توليد حقيقي قبل الحفظ.");
    }

    const result = await validateProvider({
      ...providerInput,
      providerTypeId,
      testModel: mode === "verify" ? testModel : providerInput.testModel,
      requestId,
      organizationId: session.organizationId,
      signal: request.signal,
    });

    let validationId: string | undefined;
    let validationExpiresAt: Date | undefined;
    const modelTest = result.modelTest;
    if (modelTest) {
      const expiresAt = new Date(Date.now() + providerValidationTtlSeconds() * 1000);
      validationExpiresAt = expiresAt;
      const configHash = providerValidationConfigHash({
        provider: providerInput.provider,
        providerTypeId: result.providerTypeId,
        providerSlug: result.providerSlug,
        transportMode: result.transportMode,
        credentialMode: result.credentialMode,
        baseUrl: result.normalizedBaseUrl,
        gatewayId: providerInput.gatewayId,
        keyAlias: providerInput.keyAlias,
        testModel: modelTest.model,
        allowedModels: providerInput.allowedModels,
        skipCache: providerInput.skipCache,
        cacheTtl: providerInput.cacheTtl,
        collectLog: providerInput.collectLog,
      });
      const [created] = await db().transaction(async (tx) => {
        const [row] = await tx.insert(providerValidationSessions).values({
          organizationId: session.organizationId,
          userId: session.userId,
          provider: providerInput.provider,
          providerTypeId: result.providerTypeId,
          providerSlug: result.providerSlug,
          transportMode: result.transportMode,
          credentialMode: result.credentialMode,
          gatewayId: providerInput.gatewayId,
          keyAlias: providerInput.keyAlias,
          normalizedBaseUrl: result.normalizedBaseUrl,
          apiKeyHash: providerInput.apiKey ? hashApiKey(providerInput.apiKey) : null,
          configHash,
          models: result.models,
          testedModel: modelTest.model,
          latencyMs: result.latencyMs,
          expiresAt,
        }).returning({ id: providerValidationSessions.id });
        if (!row) throw new Error("PROVIDER_VALIDATION_SESSION_CREATE_FAILED");
        await tx.insert(auditLogs).values({
          organizationId: session.organizationId,
          actorType: "user",
          actorId: session.userId,
          action: "provider.validation.succeeded",
          resourceType: "provider_validation_session",
          resourceId: row.id,
          metadata: {
            provider: providerInput.provider,
            providerTypeId: result.providerTypeId,
            providerSlug: result.providerSlug,
            transportMode: result.transportMode,
            credentialMode: result.credentialMode,
            testedModel: modelTest.model,
            modelCount: result.models.length,
            requestId,
          },
        });
        return [row];
      });
      validationId = created.id;
    }

    return apiSuccess({
      ...result,
      validationId,
      validationExpiresAt: validationExpiresAt?.toISOString(),
      verificationStatus: modelTest ? "verified" : "models_discovered",
    }, requestId);
  } catch (error) {
    const normalized = normalizeUnknownProviderError(error, { requestId });
    const mapped = error instanceof ApiError
      ? error
      : new ApiError(normalized.httpStatus, normalized.code, normalized.message, normalized.diagnostic());
    return handleApiError(mapped, requestId, "/api/dashboard/providers/validate");
  }
}
