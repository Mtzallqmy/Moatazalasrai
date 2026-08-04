import { z } from "zod";
import { currentSession } from "@/lib/auth/session";
import {
  beginMfaEnrollment,
  completeMfaEnrollment,
  freshWebSessionMfa,
  markWebSessionMfaVerified,
  mfaStatusForUser,
} from "@/lib/auth/mfa";
import { ApiError, apiFailure, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { recordAuditEvent, recordDeniedAccess } from "@/lib/security/audit";

export const runtime = "nodejs";

const confirmationSchema = z.object({
  code: z.string().trim().min(6).max(64),
}).strict();

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  let session: Awaited<ReturnType<typeof currentSession>> = null;
  try {
    assertSameOrigin(request);
    session = await currentSession();
    if (!session) return apiFailure(401, "UNAUTHORIZED", "يجب تسجيل الدخول.", requestId);
    const status = await mfaStatusForUser(session.userId);
    if (status.enabled && !(await freshWebSessionMfa(session.sessionId, session.userId))) {
      throw new ApiError(403, "MFA_REQUIRED", "تحقق بالعامل الحالي قبل استبداله.");
    }
    const enrollment = await beginMfaEnrollment({
      userId: session.userId,
      email: session.email,
      issuer: session.organizationName ? `Moataz — ${session.organizationName}` : "Moataz Agent Platform",
    });
    await recordAuditEvent({
      organizationId: session.organizationId,
      actorType: "user",
      actorId: session.userId,
      action: status.enabled ? "mfa.factor_replacement.started" : "mfa.enrollment.started",
      resourceType: "user",
      resourceId: session.userId,
      metadata: { requestId },
    });
    return apiSuccess(enrollment, requestId, 201);
  } catch (error) {
    if (session && error instanceof ApiError && error.code === "MFA_REQUIRED") {
      await recordDeniedAccess({
        organizationId: session.organizationId,
        actorId: session.userId,
        reason: error.code,
        requestId,
        route: "/api/auth/mfa/enroll",
      });
    }
    return handleApiError(error, requestId, "/api/auth/mfa/enroll");
  }
}

export async function PUT(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await currentSession();
    if (!session) return apiFailure(401, "UNAUTHORIZED", "يجب تسجيل الدخول.", requestId);
    const body = await parseJson(request, confirmationSchema, 4 * 1024);
    const completed = await completeMfaEnrollment(session.userId, body.code);
    await markWebSessionMfaVerified({
      userId: session.userId,
      sessionId: session.sessionId,
      method: "totp",
    });
    await recordAuditEvent({
      organizationId: session.organizationId,
      actorType: "user",
      actorId: session.userId,
      action: "mfa.enrollment.completed",
      resourceType: "user",
      resourceId: session.userId,
      metadata: { requestId, recoveryCodeCount: completed.recoveryCodes.length },
    });
    return apiSuccess(completed, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/auth/mfa/enroll");
  }
}
