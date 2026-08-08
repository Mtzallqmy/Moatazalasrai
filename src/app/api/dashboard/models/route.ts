import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { modelCatalog, providerCredentials } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("agents:run");
    const [catalogRows, credentials] = await Promise.all([db().select({
      providerCredentialId: modelCatalog.providerCredentialId,
      providerName: providerCredentials.name,
      provider: providerCredentials.provider,
      model: modelCatalog.model,
      capabilities: modelCatalog.capabilities,
      freeTierEligible: modelCatalog.freeTierEligible,
      available: modelCatalog.available,
      latencyMs: modelCatalog.latencyMs,
    }).from(modelCatalog).innerJoin(providerCredentials, eq(providerCredentials.id, modelCatalog.providerCredentialId))
      .where(and(
        eq(modelCatalog.organizationId, session.organizationId),
        eq(modelCatalog.available, true),
        eq(providerCredentials.enabled, true),
        eq(providerCredentials.validationStatus, "verified"),
      )).orderBy(asc(providerCredentials.name), asc(modelCatalog.model)),
    db().select({
      id: providerCredentials.id,
      name: providerCredentials.name,
      provider: providerCredentials.provider,
      defaultModel: providerCredentials.defaultModel,
      allowedModels: providerCredentials.allowedModels,
      discoveredModels: providerCredentials.discoveredModels,
      capabilities: providerCredentials.capabilities,
      latencyMs: providerCredentials.lastValidationLatencyMs,
    }).from(providerCredentials).where(and(
      eq(providerCredentials.organizationId, session.organizationId),
      eq(providerCredentials.enabled, true),
      eq(providerCredentials.validationStatus, "verified"),
      isNull(providerCredentials.deletedAt),
    )).orderBy(asc(providerCredentials.name))]);

    const byKey = new Map(catalogRows.map((row) => [`${row.providerCredentialId}:${row.model}`, row]));
    for (const credential of credentials) {
      const models = new Set([
        ...(credential.defaultModel ? [credential.defaultModel] : []),
        ...credential.allowedModels,
        ...credential.discoveredModels,
      ].map((model) => model.trim()).filter(Boolean));
      for (const model of models) {
        const key = `${credential.id}:${model}`;
        if (byKey.has(key)) continue;
        byKey.set(key, {
          providerCredentialId: credential.id,
          providerName: credential.name,
          provider: credential.provider,
          model,
          capabilities: credential.capabilities,
          freeTierEligible: false,
          available: true,
          latencyMs: credential.latencyMs,
        });
      }
    }
    const rows = [...byKey.values()].sort((left, right) =>
      left.providerName.localeCompare(right.providerName, "ar") || left.model.localeCompare(right.model),
    );
    return apiSuccess(rows, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/models");
  }
}
