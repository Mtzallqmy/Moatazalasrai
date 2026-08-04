import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { runs } from "@/db/schema";
import { cancelAgentRun, getRunEvents, listOrganizationRuns } from "@/lib/agents/runtime";
import { requireSession } from "@/lib/auth/authorization";
import { requireConversationAccess } from "@/lib/chat/access";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { paginationSchema, runCancelSchema, uuidSchema } from "@/lib/http/contracts";

const runStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("runs:read");
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId");
    if (runId) {
      const parsedRunId = uuidSchema.parse(runId);
      const [run] = await db().select({ conversationId: runs.conversationId }).from(runs).where(and(
        eq(runs.id, parsedRunId),
        eq(runs.organizationId, session.organizationId),
      )).limit(1);
      if (!run?.conversationId) throw new ApiError(404, "RUN_NOT_FOUND", "عملية التشغيل غير موجودة.");
      await requireConversationAccess({
        organizationId: session.organizationId,
        conversationId: run.conversationId,
        userId: session.userId,
        role: session.role,
        access: "read",
        includeArchived: true,
      });
      const events = await getRunEvents(session.organizationId, parsedRunId);
      return apiSuccess(events, requestId);
    }
    const query = paginationSchema.parse(Object.fromEntries(url.searchParams));
    const rawStatus = url.searchParams.get("status");
    const status = rawStatus ? runStatusSchema.parse(rawStatus) : undefined;
    const result = await listOrganizationRuns({
      organizationId: session.organizationId,
      userId: session.userId,
      role: session.role,
      page: query.page,
      limit: query.limit,
      status,
    });
    return apiSuccess(result.rows, requestId, 200, {
      pagination: {
        ...query,
        total: result.total,
        pages: Math.ceil(result.total / query.limit),
      },
    });
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/runs");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("agents:run");
    const body = await parseJson(request, runCancelSchema, 4 * 1024);
    const [run] = await db().select({ conversationId: runs.conversationId }).from(runs).where(and(
      eq(runs.id, body.runId),
      eq(runs.organizationId, session.organizationId),
    )).limit(1);
    if (!run?.conversationId) throw new ApiError(404, "RUN_NOT_FOUND", "عملية التشغيل غير موجودة.");
    await requireConversationAccess({
      organizationId: session.organizationId,
      conversationId: run.conversationId,
      userId: session.userId,
      role: session.role,
      access: "write",
      includeArchived: true,
    });
    const result = await cancelAgentRun(session.organizationId, body.runId);
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/runs");
  }
}
