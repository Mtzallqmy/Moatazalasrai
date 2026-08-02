import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/authorization";
import { completeGoogleOAuth } from "@/lib/site-connections/google-oauth";
import { ApiError, getRequestId, handleApiError } from "@/lib/http/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("site_connections:manage");
    const url = new URL(request.url);
    const state = url.searchParams.get("state")?.trim();
    const code = url.searchParams.get("code")?.trim();
    const oauthError = url.searchParams.get("error")?.trim();
    if (oauthError) {
      throw new ApiError(422, "GOOGLE_OAUTH_CANCELLED", "أُلغي تفويض Google أو رُفض.", { oauthError });
    }
    if (!state || !code || state.length > 500 || code.length > 4_000) {
      throw new ApiError(400, "GOOGLE_OAUTH_CALLBACK_INVALID", "استجابة Google OAuth غير مكتملة.");
    }
    const connection = await completeGoogleOAuth({
      organizationId: session.organizationId,
      userId: session.userId,
      state,
      code,
      requestId,
    });
    const destination = new URL("/dashboard/site-connections", url.origin);
    destination.searchParams.set("connected", connection.id);
    return NextResponse.redirect(destination, { status: 303, headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/site-connections/oauth/callback");
  }
}
