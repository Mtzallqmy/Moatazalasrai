import { requireSession } from "@/lib/auth/authorization";
import { revokeAllSessions } from "@/lib/auth/session";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError } from "@/lib/http/api";

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    await revokeAllSessions(session.userId);
    return apiSuccess({ revoked: true }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/auth/sessions");
  }
}
