import { revokeCurrentSession } from "@/lib/auth/session";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError } from "@/lib/http/api";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    await revokeCurrentSession();
    return apiSuccess({ loggedOut: true }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/auth/logout");
  }
}
