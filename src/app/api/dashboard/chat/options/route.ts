import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeBases } from "@/db/schema";
import { aiFeatureEnabled } from "@/ai/config";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const kind = new URL(request.url).searchParams.get("kind");
    if (kind !== "knowledge") throw new ApiError(400, "INVALID_OPTION_KIND", "نوع الخيارات غير مدعوم.");
    if (!aiFeatureEnabled("RAG")) throw new ApiError(404, "FEATURE_DISABLED", "ميزة قواعد المعرفة غير مفعلة.");
    const session = await requireSession("files:read");
    const rows = await db().select({ id: knowledgeBases.id, name: knowledgeBases.name })
      .from(knowledgeBases)
      .where(eq(knowledgeBases.organizationId, session.organizationId))
      .orderBy(desc(knowledgeBases.updatedAt))
      .limit(100);
    return apiSuccess(rows, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/chat/options");
  }
}
