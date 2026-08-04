import { currentSession } from "@/lib/auth/session";
import { mfaStatusForUser, userHasPrivilegedMembership } from "@/lib/auth/mfa";
import { apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await currentSession();
    if (!session) return apiFailure(401, "UNAUTHORIZED", "يجب تسجيل الدخول.", requestId);
    const [status, required] = await Promise.all([
      mfaStatusForUser(session.userId),
      userHasPrivilegedMembership(session.userId),
    ]);
    return apiSuccess({ required, ...status }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/auth/mfa/status");
  }
}
