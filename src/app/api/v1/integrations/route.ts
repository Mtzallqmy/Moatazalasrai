import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    const rows = await db().select({
      id: integrations.id,
      kind: integrations.kind,
      name: integrations.name,
      tokenHint: integrations.tokenHint,
      status: integrations.status,
      enabled: integrations.enabled,
      lastVerifiedAt: integrations.lastVerifiedAt,
      lastErrorCode: integrations.lastErrorCode,
      updatedAt: integrations.updatedAt,
    }).from(integrations).where(eq(integrations.organizationId, principal.organizationId))
      .orderBy(desc(integrations.updatedAt));
    return apiSuccess({ integrations: rows }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/integrations");
  }
}
