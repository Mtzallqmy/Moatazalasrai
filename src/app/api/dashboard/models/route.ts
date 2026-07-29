import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { modelCatalog, providerCredentials } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("agents:run");
    const rows = await db().select({
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
      )).orderBy(asc(providerCredentials.name), asc(modelCatalog.model));
    return apiSuccess(rows, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/models");
  }
}
