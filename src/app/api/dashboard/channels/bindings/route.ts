// Replaces channel agent, provider, model, and tool bindings atomically.
import { requireSession } from "@/lib/auth/authorization";
import { channelBindingUpdateSchema, replaceChannelBindings } from "@/lib/channels/admin";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("channels:manage");
    const update = await parseJson(request, channelBindingUpdateSchema, 128 * 1024);
    await replaceChannelBindings({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      update,
    });
    return apiSuccess({ updated: true }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/channels/bindings");
  }
}
