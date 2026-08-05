// Explicit unlink endpoint removes the channel and cascades only channel-owned bindings.
import { z } from "zod";
import { requireSession } from "@/lib/auth/authorization";
import { deleteChannelConnection } from "@/lib/channels/admin";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";

export const runtime = "nodejs";

const schema = z.object({ connectionId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("channels:manage");
    const body = await parseJson(request, schema, 4 * 1024);
    return apiSuccess(await deleteChannelConnection({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      connectionId: body.connectionId,
    }), requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/channels/unlink");
  }
}
