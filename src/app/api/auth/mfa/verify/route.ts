import { z } from "zod";
import { currentSession } from "@/lib/auth/session";
import { markWebSessionMfaVerified, verifyUserMfaCode } from "@/lib/auth/mfa";
import { apiFailure, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { recordAuditEvent, recordDeniedAccess } from "@/lib/security/audit";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const schema = z.object({ code: z.string().trim().min(6).max(64) }).strict();

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  let session: Awaited<ReturnType<typeof currentSession>> = null;
  try {
    assertSameOrigin(request);
    session = await currentSession();
    if (!session) return apiFailure(401, "UNAUTHORIZED", "يجب تسجيل الدخول.", requestId);
    await enforceRateLimit({
      scope: "auth.mfa.verify",
      key: `${session.userId}:${session.sessionId}`,
      limit: 8,
      windowMs: 10 * 60_000,
    });
    const body = await parseJson(request, schema, 4 * 1024);
    const verification = await verifyUserMfaCode(session.userId, body.code);
    await markWebSessionMfaVerified({
      userId: session.userId,
      sessionId: session.sessionId,
      method: verification.method,
    });
    await recordAuditEvent({
      organizationId: session.organizationId,
      actorType: "user",
      actorId: session.userId,
      action: "mfa.verified",
      resourceType: "session",
      resourceId: session.sessionId,
      metadata: { requestId, method: verification.method },
    });
    return apiSuccess({ verified: true, method: verification.method }, requestId);
  } catch (error) {
    if (session) {
      await recordDeniedAccess({
        organizationId: session.organizationId,
        actorId: session.userId,
        reason: error instanceof Error ? error.message.slice(0, 120) : "MFA_VERIFY_FAILED",
        requestId,
        route: "/api/auth/mfa/verify",
      });
    }
    return handleApiError(error, requestId, "/api/auth/mfa/verify");
  }
}
