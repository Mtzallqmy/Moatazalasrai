import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentVersions, agents, auditLogs, modelCatalog, providerCredentials } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/security/encryption";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import {
  paginationSchema,
  providerDeleteSchema,
  providerInputSchema,
  providerUpdateSchema,
} from "@/lib/http/contracts";
import { defaultBaseUrl, validateProvider } from "@/lib/providers/registry";
import { ProviderError } from "@/lib/providers/types";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { inferModelCapabilities, isFreeTierModel } from "@/server/models/capabilities";

export const runtime = "nodejs";

const publicSelection = {
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
  enabled: providerCredentials.enabled,
  createdAt: providerCredentials.createdAt,
  updatedAt: providerCredentials.updatedAt,
};

function mapProviderError(error: unknown): never {
  if (error instanceof ProviderError) {
    throw new ApiError(error.httpStatus, error.code, error.message, { providerStatus: error.providerStatus });
  }
  throw error;
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("providers:read");
    const query = paginationSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const offset = (query.page - 1) * query.limit;
    const [rows, totalRows] = await Promise.all([
      db().select(publicSelection)
        .from(providerCredentials)
        .where(eq(providerCredentials.organizationId, session.organizationId))
        .orderBy(desc(providerCredentials.createdAt))
        .limit(query.limit)
        .offset(offset),
      db().select({ value: count() })
        .from(providerCredentials)
        .where(eq(providerCredentials.organizationId, session.organizationId)),
    ]);
    const total = totalRows[0]?.value ?? 0;
    return apiSuccess(rows, requestId, 200, {
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
    await enforceRateLimit({
      scope: "provider.create",
      key: `${session.organizationId}:${session.userId}`,
      limit: 8,
      windowMs: 10 * 60_000,
    });
    const body = await parseJson(request, providerInputSchema, 16 * 1024);
    if (!body.testModel) {
      throw new ApiError(400, "MODEL_TEST_REQUIRED", "اختر نموذجًا لإجراء اختبار توليد قصير قبل الحفظ.");
    }
    const baseUrl = body.baseUrl || defaultBaseUrl(body.provider);
    if (!baseUrl) throw new ApiError(400, "BASE_URL_REQUIRED", "أدخل Base URL للمزود المتوافق.");

    let validation;
    try {
      validation = await validateProvider({ ...body, baseUrl, requestId, signal: request.signal });
    } catch (error) {
      mapProviderError(error);
    }

    const encryptedSecret = encryptSecret(body.apiKey);
    const created = await db().transaction(async (tx) => {
      const [credential] = await tx.insert(providerCredentials).values({
        organizationId: session.organizationId,
        provider: body.provider,
        name: body.name,
        baseUrl: validation.normalizedBaseUrl,
        encryptedSecret,
        secretHint: maskSecret(body.apiKey),
        discoveredModels: validation.models,
        validationStatus: "verified",
        lastValidatedAt: new Date(),
        lastValidationLatencyMs: validation.latencyMs,
      }).returning(publicSelection);
      if (!credential) throw new Error("PROVIDER_CREATE_FAILED");
      if (validation.models.length > 0) {
        await tx.insert(modelCatalog).values(validation.models.map((model) => ({
          organizationId: session.organizationId,
          providerCredentialId: credential.id,
          model,
          capabilities: inferModelCapabilities(body.provider, model),
          freeTierEligible: isFreeTierModel(model),
          latencyMs: validation.latencyMs,
        }))).onConflictDoUpdate({
          target: [modelCatalog.providerCredentialId, modelCatalog.model],
          set: {
            available: true,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "provider.created",
        resourceType: "provider_credential",
        resourceId: credential.id,
        metadata: { provider: credential.provider, modelCount: credential.discoveredModels.length, requestId },
      });
      return credential;
    });
    return apiSuccess(created, requestId, 201, { latencyMs: validation.latencyMs });
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/providers");
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("providers:manage");
    const body = await parseJson(request, providerUpdateSchema, 16 * 1024);
    const [current] = await db()
      .select()
      .from(providerCredentials)
      .where(and(
        eq(providerCredentials.id, body.id),
        eq(providerCredentials.organizationId, session.organizationId),
      ))
      .limit(1);
    if (!current) throw new ApiError(404, "PROVIDER_NOT_FOUND", "اتصال المزود غير موجود.");
    if (body.enabled === true && current.validationStatus !== "verified" && !body.revalidate && !body.apiKey) {
      throw new ApiError(409, "PROVIDER_NOT_VERIFIED", "أعد فحص المزود قبل تفعيله.");
    }

    const shouldValidate = body.revalidate === true || Boolean(body.apiKey) || Boolean(body.baseUrl);
    let validation: Awaited<ReturnType<typeof validateProvider>> | undefined;
    let apiKey: string | undefined;
    if (shouldValidate) {
      await enforceRateLimit({
        scope: "provider.update.validate",
        key: `${session.organizationId}:${session.userId}`,
        limit: 12,
        windowMs: 10 * 60_000,
      });
      apiKey = body.apiKey ?? decryptSecret(current.encryptedSecret);
      try {
        validation = await validateProvider({
          provider: current.provider,
          apiKey,
          baseUrl: body.baseUrl ?? current.baseUrl,
          testModel: body.testModel ?? current.discoveredModels[0],
          requestId,
          signal: request.signal,
        });
      } catch (error) {
        const providerError = error instanceof ProviderError ? error : null;
        await db().update(providerCredentials).set({
          validationStatus: "failed",
          lastErrorCode: providerError?.code ?? "PROVIDER_VALIDATION_FAILED",
          consecutiveFailures: current.consecutiveFailures + 1,
          enabled: false,
          updatedAt: new Date(),
        }).where(and(
          eq(providerCredentials.id, current.id),
          eq(providerCredentials.organizationId, session.organizationId),
        ));
        mapProviderError(error);
      }
    }

    const [updated] = await db().update(providerCredentials).set({
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      ...(validation ? {
        baseUrl: validation.normalizedBaseUrl,
        discoveredModels: validation.models,
        validationStatus: "verified" as const,
        lastValidatedAt: new Date(),
        lastValidationLatencyMs: validation.latencyMs,
        lastErrorCode: null,
        consecutiveFailures: 0,
        circuitOpenUntil: null,
      } : {}),
      ...(body.apiKey && apiKey ? {
        encryptedSecret: encryptSecret(apiKey),
        secretHint: maskSecret(apiKey),
      } : {}),
      updatedAt: new Date(),
    }).where(and(
      eq(providerCredentials.id, current.id),
      eq(providerCredentials.organizationId, session.organizationId),
    )).returning(publicSelection);

    if (!updated) throw new ApiError(404, "PROVIDER_NOT_FOUND", "اتصال المزود غير موجود.");
    if (validation?.models.length) {
      await db().insert(modelCatalog).values(validation.models.map((model) => ({
        organizationId: session.organizationId,
        providerCredentialId: updated.id,
        model,
        capabilities: inferModelCapabilities(updated.provider, model),
        freeTierEligible: isFreeTierModel(model),
        latencyMs: validation.latencyMs,
        available: true,
        lastSeenAt: new Date(),
      }))).onConflictDoUpdate({
        target: [modelCatalog.providerCredentialId, modelCatalog.model],
        set: {
          available: true,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    await db().insert(auditLogs).values({
      organizationId: session.organizationId,
      actorType: "user",
      actorId: session.userId,
      action: validation ? "provider.revalidated" : "provider.updated",
      resourceType: "provider_credential",
      resourceId: updated.id,
      metadata: { enabled: updated.enabled, requestId },
    });
    return apiSuccess(updated, requestId);
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
    const [linked] = await db().select({ value: count() })
      .from(agentVersions)
      .innerJoin(agents, eq(agents.id, agentVersions.agentId))
      .where(and(
        eq(agentVersions.providerCredentialId, body.id),
        eq(agents.organizationId, session.organizationId),
      ));
    if ((linked?.value ?? 0) > 0) {
      throw new ApiError(409, "PROVIDER_IN_USE", "لا يمكن حذف المزود لأنه مرتبط بإصدارات وكلاء.", { affectedAgents: linked.value });
    }
    const [deleted] = await db().delete(providerCredentials).where(and(
      eq(providerCredentials.id, body.id),
      eq(providerCredentials.organizationId, session.organizationId),
    )).returning({ id: providerCredentials.id, name: providerCredentials.name });
    if (!deleted) throw new ApiError(404, "PROVIDER_NOT_FOUND", "اتصال المزود غير موجود.");
    await db().insert(auditLogs).values({
      organizationId: session.organizationId,
      actorType: "user",
      actorId: session.userId,
      action: "provider.deleted",
      resourceType: "provider_credential",
      resourceId: deleted.id,
      metadata: { name: deleted.name, requestId },
    });
    return apiSuccess({ deleted: true, id: deleted.id }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/providers");
  }
}
