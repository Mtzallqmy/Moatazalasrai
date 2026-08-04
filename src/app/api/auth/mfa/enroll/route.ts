import { z } from "zod";
import { currentSession } from "@/lib/auth/session";
import {
  beginMfaEnrollment,
  completeMfaEnrollment,
  markWebSessionMfaVerified,
} from "@/lib/auth/mfa";
import { apiFailure, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { recordAuditEvent } from "@/lib/security/audit";

export const runtime = "nodejs";

const confirmationSchema = z.object({
  code: z.string().trim().min(6).max(64),
}).strict();

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await currentSession();
    if (!session) return apiFailure(401, "UNAUTHORIZED", "يجب تسجيل الدخول.", requestId);
    const enrollment = await beginMfaEnrollment({
      userId: session.userId,
      email: session.email,
      issuer: session.organizationName ? `Moataz — ${session.organizationName}` : "Moataz Agent Platform",
    });
    await recordAuditEvent({
      organizationId: session.organizationId,
      actorType: "user",
      actorId: session.userId,
      action: "mfa.enrollment.started",
      resourceType: "user",
      resourceId: session.userId,
      metadata: { requestId },
    });
    return apiSuccess(enrollment, requestId, 201);
  } catch (error) {
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
