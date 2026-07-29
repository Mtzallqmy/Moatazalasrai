import { authenticateApiKey } from "@/lib/auth/api-key";
import { mobileMe } from "@/lib/auth/mobile";
import { apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal?.userId || principal.kind !== "mobile_session") {
      return apiFailure(401, "UNAUTHORIZED", "جلسة التطبيق غير صالحة.", requestId);
    }
    const identity = await mobileMe(principal.userId, principal.organizationId);
    if (!identity) return apiFailure(403, "MEMBERSHIP_NOT_FOUND", "تعذر العثور على عضوية مساحة العمل.", requestId);
    return apiSuccess({ identity, scopes: principal.scopes }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/mobile/v1/me");
  }
}
