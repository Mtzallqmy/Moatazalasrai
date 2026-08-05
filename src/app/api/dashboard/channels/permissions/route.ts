// Updates a channel's explicit capabilities, commands, and blocked operation classes.
import { requireSession } from "@/lib/auth/authorization";
import { channelPermissionsUpdateSchema, replaceChannelPermissions } from "@/lib/channels/admin";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("channels:manage");
    const update = await parseJson(request, channelPermissionsUpdateSchema, 32 * 1024);
    await replaceChannelPermissions({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      update,
    });
    return apiSuccess({ updated: true }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/channels/permissions");
  }
}
