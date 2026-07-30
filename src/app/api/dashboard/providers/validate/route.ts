import { z } from "zod";
import { db } from "@/db";
import { providerValidationSessions } from "@/db/provider-validation-schema";
import { auditLogs } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { providerValidationSchema } from "@/lib/http/contracts";
import { validateProvider } from "@/lib/providers/registry";
import { providerValidationTtlSeconds } from "@/lib/providers/validation-session";
import { ProviderError } from "@/lib/providers/types";
import { hashApiKey } from "@/lib/security/encryption";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const validationRequestSchema = providerValidationSchema.extend({
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
    const body = await parseJson(request, validationRequestSchema, 24 * 1024);
    const { mode, ...providerInput } = body;
    const testModel = providerInput.testModel ?? providerInput.manualModel;
    if (mode === "verify" && !testModel) {
      throw new ApiError(400, "MODEL_TEST_REQUIRED", "اختر نموذجًا لإجراء اختبار توليد حقيقي قبل الحفظ.");
    }

    const result = await validateProvider({
      ...providerInput,
      testModel: mode === "verify" ? testModel : providerInput.testModel,
      requestId,
      signal: request.signal,
    });

    let validationId: string | undefined;
    let validationExpiresAt: Date | undefined;
    if (result.modelTest) {
      validationExpiresAt = new Date(Date.now() + providerValidationTtlSeconds() * 1000);
      const [created] = await db().transaction(async (tx) => {
        const [row] = await tx.insert(providerValidationSessions).values({
          organizationId: session.organizationId,
          userId: session.userId,
          provider: providerInput.provider,
          providerSlug: result.providerSlug,
          normalizedBaseUrl: result.normalizedBaseUrl,
          apiKeyHash: hashApiKey(providerInput.apiKey),
          models: result.models,
          testedModel: result.modelTest.model,
          latencyMs: result.latencyMs,
          expiresAt: validationExpiresAt!,
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
            providerSlug: result.providerSlug,
            testedModel: result.modelTest?.model,
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
      verificationStatus: result.modelTest ? "verified" : "models_discovered",
    }, requestId);
  } catch (error) {
    if (error instanceof ProviderError) {
      error = new ApiError(error.httpStatus, error.code, error.message, {
        providerStatus: error.providerStatus,
        retryAfterMs: error.retryAfterMs,
      });
    }
    return handleApiError(error, requestId, "/api/dashboard/providers/validate");
  }
}
