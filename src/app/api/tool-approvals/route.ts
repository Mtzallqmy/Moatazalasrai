import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, toolApprovals } from "@/db/schema";
import { aiFeatureEnabled } from "@/ai/config";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { uuidSchema } from "@/lib/http/contracts";
const schema = z.object({ id: uuidSchema, decision: z.enum(["approved", "rejected"]) }).strict();
export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    if (!aiFeatureEnabled("TOOLS")) throw new ApiError(404, "FEATURE_DISABLED", "ميزة الأدوات غير مفعلة.");
    const session = await requireSession("agents:manage");
    const rows = await db().select().from(toolApprovals).where(and(eq(toolApprovals.organizationId, session.organizationId), eq(toolApprovals.status, "pending"))).orderBy(desc(toolApprovals.createdAt));
    return apiSuccess(rows, requestId);
  } catch (error) { return handleApiError(error, requestId, "/api/tool-approvals"); }
}
export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    if (!aiFeatureEnabled("TOOLS")) throw new ApiError(404, "FEATURE_DISABLED", "ميزة الأدوات غير مفعلة.");
    assertSameOrigin(request); const session = await requireSession("agents:manage"); const body = await parseJson(request, schema, 4096);
    const result = await db().transaction(async (tx) => {
      const [updated] = await tx.update(toolApprovals).set({ status: body.decision, decidedByUserId: session.userId, decidedAt: new Date() })
        .where(and(eq(toolApprovals.id, body.id), eq(toolApprovals.organizationId, session.organizationId), eq(toolApprovals.status, "pending"))).returning();
      if (!updated || updated.expiresAt <= new Date()) throw new ApiError(409, "APPROVAL_UNAVAILABLE", "الموافقة غير متاحة أو منتهية.");
      await tx.insert(auditLogs).values({ organizationId: session.organizationId, actorType: "user", actorId: session.userId,
        action: `tool_approval.${body.decision}`, resourceType: "tool_approval", resourceId: updated.id, metadata: { requestId, toolId: updated.toolId } });
      return updated;
    });
    return apiSuccess(result, requestId);
  } catch (error) { return handleApiError(error, requestId, "/api/tool-approvals"); }
}
