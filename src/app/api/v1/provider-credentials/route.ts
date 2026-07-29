import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, providerCredentials } from "@/db/schema";
import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { providerInputSchema } from "@/lib/http/contracts";
import { defaultBaseUrl, validateProvider } from "@/lib/providers/registry";
import { ProviderError } from "@/lib/providers/types";
import { encryptSecret, maskSecret } from "@/lib/security/encryption";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "providers:read");
    const rows = await db().select({
      id: providerCredentials.id,
      provider: providerCredentials.provider,
      name: providerCredentials.name,
      baseUrl: providerCredentials.baseUrl,
      secretHint: providerCredentials.secretHint,
      discoveredModels: providerCredentials.discoveredModels,
      validationStatus: providerCredentials.validationStatus,
      lastValidatedAt: providerCredentials.lastValidatedAt,
      enabled: providerCredentials.enabled,
      createdAt: providerCredentials.createdAt,
      updatedAt: providerCredentials.updatedAt,
    }).from(providerCredentials).where(eq(providerCredentials.organizationId, principal.organizationId));
    return apiSuccess({ credentials: rows }, requestId);
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
    const body = await parseJson(request, providerInputSchema, 16 * 1024);
    if (!body.testModel) throw new ApiError(400, "MODEL_TEST_REQUIRED", "يلزم نموذج لإجراء اختبار توليد حقيقي.");
    const requestedBaseUrl = body.baseUrl || defaultBaseUrl(body.provider);
    if (!requestedBaseUrl) throw new ApiError(400, "BASE_URL_REQUIRED", "يلزم Base URL للمزود المتوافق.");
    const discovery = await validateProvider({
      ...body,
      baseUrl: requestedBaseUrl,
      testModel: body.testModel,
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
    }).returning({
      id: providerCredentials.id,
      provider: providerCredentials.provider,
      name: providerCredentials.name,
      baseUrl: providerCredentials.baseUrl,
      secretHint: providerCredentials.secretHint,
      discoveredModels: providerCredentials.discoveredModels,
      validationStatus: providerCredentials.validationStatus,
      lastValidatedAt: providerCredentials.lastValidatedAt,
      enabled: providerCredentials.enabled,
    });

    if (!created) throw new Error("PROVIDER_CREATE_FAILED");

    await db().insert(auditLogs).values({
      organizationId: principal.organizationId,
      actorType: "api_key",
      actorId: principal.apiKeyId,
      action: "provider_credential.created",
      resourceType: "provider_credential",
      resourceId: created.id,
      metadata: { provider: created.provider, modelCount: created.discoveredModels.length },
    });
    return apiSuccess({ credential: created }, requestId, 201, { latencyMs: discovery.latencyMs });
  } catch (error) {
    if (error instanceof ProviderError) {
      error = new ApiError(error.httpStatus, error.code, error.message, { providerStatus: error.providerStatus });
    }
    return handleApiError(error, requestId, "/api/v1/provider-credentials");
  }
}
