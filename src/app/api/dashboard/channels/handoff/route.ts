// Creates an audited human handoff for an existing channel conversation.
import { z } from "zod";
import { requireSession } from "@/lib/auth/authorization";
import { requestAdminHandoff } from "@/lib/channels/admin";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";

export const runtime = "nodejs";

const schema = z.object({
  connectionId: z.string().uuid(),
  conversationLinkId: z.string().uuid(),
  assignedUserId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().min(2).max(500),
}).strict();

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("channels:handoff");
    const body = await parseJson(request, schema, 8 * 1024);
    return apiSuccess(await requestAdminHandoff({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      ...body,
    }), requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/channels/handoff");
  }
}
