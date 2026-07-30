import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, auditLogs, modelCatalog, organizations, providerCredentials } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/security/encryption";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import {
  paginationSchema,
  providerDeleteSchema,
  providerInputSchema,
  providerUpdateSchema,
} from "@/lib/http/contracts";
import { getProviderPreset, resolveProviderPreset } from "@/lib/providers/catalog";
import { defaultBaseUrl, inferProviderSlug, validateProvider } from "@/lib/providers/registry";
import { ProviderError, type ProviderKind } from "@/lib/providers/types";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { inferModelCapabilities, isFreeTierModel } from "@/server/models/capabilities";

export const runtime = "nodejs";

const activeProvider = sql`"provider_credentials"."deleted_at" IS NULL`;

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
  consecutiveFailures: providerCredentials.consecutiveFailures,
  circuitOpenUntil: providerCredentials.circuitOpenUntil,
  enabled: providerCredentials.enabled,
  createdAt: providerCredentials.createdAt,
  updatedAt: providerCredentials.updatedAt,
};

type PublicProvider = typeof providerCredentials.$inferSelect;

function publicProvider<T extends Pick<PublicProvider,
  "id" | "provider" | "name" | "baseUrl" | "secretHint" | "discoveredModels" |
  "validationStatus" | "lastValidatedAt" | "lastValidationLatencyMs" | "lastErrorCode" |
  "consecutiveFailures" | "circuitOpenUntil" | "enabled" | "createdAt" | "updatedAt"
>>(row: T) {
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
    throw new ApiError(400, "PROVIDER_PRESET_INVALID", "نوع المزود لا يطابق الإعداد الجاهز المختار.");
  }
  return preset;
}

function mapProviderError(error: unknown): never {
  if (error instanceof ProviderError) {
    throw new ApiError(error.httpStatus, error.code, error.message, {
      providerStatus: error.providerStatus,
      retryAfterMs: error.retryAfterMs,
    });
  }
  throw error;
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
    if (input.models.length === 0) return;
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
      set: {
        available: true,
        latencyMs: input.latencyMs,
        lastSeenAt: now,
        updatedAt: now,
      },
    });
  });
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("providers:read");
    const query = paginationSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const offset = (query.page - 1) * query.limit;
    const where = and(eq(providerCredentials.organizationId, session.organizationId), activeProvider);
    const [rows, totalRows] = await Promise.all([
      db().select(publicSelection)
        .from(providerCredentials)
        .where(where)
        .orderBy(desc(providerCredentials.createdAt))
        .limit(query.limit)
        .offset(offset),
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
    await enforceRateLimit({
      scope: "provider.create",
      key: `${session.organizationId}:${session.userId}`,
      limit: 12,
      windowMs: 10 * 60_000,
    });
    const body = await parseJson(request, providerInputSchema, 24 * 1024);
    const preset = requestedPreset(body.provider, body.providerSlug);
    const baseUrl = body.baseUrl || preset.defaultBaseUrl || defaultBaseUrl(body.provider, preset.slug);
    if (!baseUrl) throw new ApiError(400, "BASE_URL_REQUIRED", "أدخل Base URL للمزود المتوافق.");
    const testModel = body.testModel ?? body.manualModel;
    if (!testModel) {
      throw new ApiError(400, "MODEL_TEST_REQUIRED", "اختر نموذجًا أو أدخل اسم نموذج يدويًا لإجراء اختبار توليد حقيقي.");
    }

    let validation: Awaited<ReturnType<typeof validateProvider>>;
    try {
      validation = await validateProvider({
        ...body,
        providerSlug: preset.slug,
        baseUrl,
        testModel,
        requestId,
        signal: request.signal,
      });
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
        lastErrorCode: null,
        consecutiveFailures: 0,
        circuitOpenUntil: null,
        enabled: true,
      }).returning(publicSelection);
      if (!credential) throw new Error("PROVIDER_CREATE_FAILED");
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "provider.created",
        resourceType: "provider_credential",
        resourceId: credential.id,
        metadata: {
          provider: credential.provider,
          providerSlug: validation.providerSlug,
          apiStyle: validation.apiStyle,
          modelCount: validation.models.length,
          testedModel: validation.modelTest?.model,
          requestId,
        },
      });
      return credential;
    });
    await syncModelCatalog({
      organizationId: session.organizationId,
      providerCredentialId: created.id,
      provider: created.provider,
      models: validation.models,
      latencyMs: validation.latencyMs,
    });
    return apiSuccess(publicProvider(created), requestId, 201, {
      latencyMs: validation.latencyMs,
      stages: validation.stages,
      modelTest: validation.modelTest,
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
    const body = await parseJson(request, providerUpdateSchema, 24 * 1024);
    const [current] = await db().select().from(providerCredentials).where(and(
      eq(providerCredentials.id, body.id),
      eq(providerCredentials.organizationId, session.organizationId),
      activeProvider,
    )).limit(1);
    if (!current) throw new ApiError(404, "PROVIDER_NOT_FOUND", "اتصال المزود غير موجود.");

    const currentSlug = inferProviderSlug(current.provider, current.baseUrl);
    const preset = requestedPreset(current.provider, body.providerSlug ?? currentSlug);
    const nextBaseUrl = body.baseUrl ?? (body.providerSlug && body.providerSlug !== currentSlug
      ? preset.defaultBaseUrl
      : current.baseUrl);
    if (!nextBaseUrl) throw new ApiError(400, "BASE_URL_REQUIRED", "أدخل Base URL صالحًا لهذا المزود.");
    const baseChanged = nextBaseUrl.replace(/\/+$/, "") !== current.baseUrl.replace(/\/+$/, "");
    const presetChanged = preset.slug !== currentSlug;
    const shouldValidate = body.revalidate === true || Boolean(body.apiKey) || baseChanged || presetChanged;

    if (body.enabled === true && current.validationStatus !== "verified" && !shouldValidate) {
      throw new ApiError(409, "PROVIDER_NOT_VERIFIED", "أعد فحص المزود قبل تفعيله.");
    }

    let validation: Awaited<ReturnType<typeof validateProvider>> | undefined;
    let apiKey: string | undefined;
    if (shouldValidate) {
      await enforceRateLimit({
        scope: "provider.update.validate",
        key: `${session.organizationId}:${session.userId}`,
        limit: 16,
        windowMs: 10 * 60_000,
      });
      apiKey = body.apiKey ?? decryptSecret(current.encryptedSecret);
      const testModel = body.testModel ?? body.manualModel ?? current.discoveredModels[0];
      if (!testModel) throw new ApiError(400, "MODEL_TEST_REQUIRED", "اختر نموذج اختبار قبل إعادة فحص المزود.");
      try {
        validation = await validateProvider({
          provider: current.provider,
          providerSlug: preset.slug,
          apiKey,
          baseUrl: nextBaseUrl,
          testModel,
          manualModel: body.manualModel,
          requestId,
          signal: request.signal,
        });
      } catch (error) {
        // Keep the last known-good credential untouched when an edit or revalidation fails.
        mapProviderError(error);
      }
    }

    const now = new Date();
    const [updated] = await db().transaction(async (tx) => {
      const [row] = await tx.update(providerCredentials).set({
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        ...(validation ? {
          baseUrl: validation.normalizedBaseUrl,
          discoveredModels: validation.models,
          validationStatus: "verified" as const,
          lastValidatedAt: now,
          lastValidationLatencyMs: validation.latencyMs,
          lastErrorCode: null,
          consecutiveFailures: 0,
          circuitOpenUntil: null,
          enabled: body.enabled ?? true,
        } : {}),
        ...(body.apiKey && apiKey ? {
          encryptedSecret: encryptSecret(apiKey),
          secretHint: maskSecret(apiKey),
        } : {}),
        updatedAt: now,
      }).where(and(
        eq(providerCredentials.id, current.id),
        eq(providerCredentials.organizationId, session.organizationId),
        activeProvider,
      )).returning(publicSelection);
      if (!row) throw new ApiError(404, "PROVIDER_NOT_FOUND", "اتصال المزود غير موجود.");
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: validation ? "provider.revalidated" : "provider.updated",
        resourceType: "provider_credential",
        resourceId: row.id,
        metadata: {
          enabled: row.enabled,
          providerSlug: validation?.providerSlug ?? inferProviderSlug(row.provider, row.baseUrl),
          modelCount: row.discoveredModels.length,
          requestId,
        },
      });
      return [row];
    });

    if (validation) {
      await syncModelCatalog({
        organizationId: session.organizationId,
        providerCredentialId: updated.id,
        provider: updated.provider,
        models: validation.models,
        latencyMs: validation.latencyMs,
      });
    }
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
    const [current] = await db().select({ id: providerCredentials.id, name: providerCredentials.name })
      .from(providerCredentials)
      .where(and(
        eq(providerCredentials.id, body.id),
        eq(providerCredentials.organizationId, session.organizationId),
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
            "circuit_open_until" = NULL,
            "updated_at" = ${now}
        WHERE "id" = ${current.id}
          AND "organization_id" = ${session.organizationId}
          AND "deleted_at" IS NULL
      `);
      await tx.update(modelCatalog).set({ available: false, updatedAt: now }).where(and(
        eq(modelCatalog.organizationId, session.organizationId),
        eq(modelCatalog.providerCredentialId, current.id),
      ));
      await tx.update(organizations).set({
        defaultProviderCredentialId: null,
        defaultModel: null,
        updatedAt: now,
      }).where(and(
        eq(organizations.id, session.organizationId),
        eq(organizations.defaultProviderCredentialId, current.id),
      ));
      await tx.update(agents).set({
        defaultProviderCredentialId: null,
        defaultModel: null,
        updatedAt: now,
      }).where(and(
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
        metadata: { name: current.name, softDelete: true, requestId },
      });
    });
    return apiSuccess({ deleted: true, id: current.id }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/providers");
  }
}
