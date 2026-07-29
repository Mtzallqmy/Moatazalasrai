import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { backgroundJobs } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { uuidSchema } from "@/lib/http/contracts";
const schema = z.object({ id: uuidSchema }).strict();
export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("runs:read");
    const rows = await db().select().from(backgroundJobs).where(eq(backgroundJobs.organizationId, session.organizationId)).orderBy(desc(backgroundJobs.createdAt)).limit(100);
    return apiSuccess(rows, requestId);
  } catch (error) { return handleApiError(error, requestId, "/api/jobs"); }
}
export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request); const session = await requireSession("agents:manage"); const body = await parseJson(request, schema, 4096);
    const [cancelled] = await db().update(backgroundJobs).set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(backgroundJobs.id, body.id), eq(backgroundJobs.organizationId, session.organizationId), eq(backgroundJobs.status, "queued"))).returning();
    if (!cancelled) throw new ApiError(409, "JOB_NOT_CANCELLABLE", "المهمة غير موجودة أو بدأت بالفعل.");
    return apiSuccess(cancelled, requestId);
  } catch (error) { return handleApiError(error, requestId, "/api/jobs"); }
}
