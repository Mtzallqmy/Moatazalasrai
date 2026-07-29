import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, knowledgeBases } from "@/db/schema";
import { aiFeatureEnabled } from "@/ai/config";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
const schema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(1000).optional() }).strict();
function enabled() { if (!aiFeatureEnabled("RAG")) throw new ApiError(404, "FEATURE_DISABLED", "ميزة قواعد المعرفة غير مفعلة."); }
export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try { enabled(); const session = await requireSession("files:read"); const rows = await db().select().from(knowledgeBases).where(eq(knowledgeBases.organizationId, session.organizationId)).orderBy(desc(knowledgeBases.updatedAt)); return apiSuccess(rows, requestId); }
  catch (error) { return handleApiError(error, requestId, "/api/knowledge-bases"); }
}
export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    enabled(); assertSameOrigin(request); const session = await requireSession("files:manage"); const body = await parseJson(request, schema, 4096);
    const created = await db().transaction(async (tx) => {
      const [row] = await tx.insert(knowledgeBases).values({ organizationId: session.organizationId, ...body }).returning();
      await tx.insert(auditLogs).values({ organizationId: session.organizationId, actorType: "user", actorId: session.userId,
        action: "knowledge_base.created", resourceType: "knowledge_base", resourceId: row!.id, metadata: { requestId } });
      return row;
    });
    return apiSuccess(created, requestId, 201);
  } catch (error) { return handleApiError(error, requestId, "/api/knowledge-bases"); }
}
