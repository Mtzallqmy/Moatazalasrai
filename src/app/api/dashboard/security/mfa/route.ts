import { z } from "zod";
import { requireSession } from "@/lib/auth/authorization";
import {
  beginMfaEnrollment,
  confirmMfaEnrollment,
  disableMfa,
  mfaStatus,
  regenerateRecoveryCodes,
} from "@/lib/auth/mfa";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const operationSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("begin"), password: z.string().min(1).max(128) }).strict(),
  z.object({ operation: z.literal("confirm"), code: z.string().trim().min(6).max(32) }).strict(),
  z.object({ operation: z.literal("regenerate_recovery"), password: z.string().min(1).max(128), code: z.string().trim().min(6).max(32) }).strict(),
  z.object({ operation: z.literal("disable"), password: z.string().min(1).max(128), code: z.string().trim().min(6).max(32) }).strict(),
]);

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("security:read");
    return apiSuccess(await mfaStatus(session.userId), requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/security/mfa");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("security:read");
    await enforceRateLimit({
      scope: "dashboard.security.mfa",
      key: `${session.userId}:${requestClientKey(request)}`,
      limit: 12,
      windowMs: 15 * 60_000,
    });
    const operation = await parseJson(request, operationSchema, 16 * 1024);
    if (operation.operation === "begin") {
      return apiSuccess(await beginMfaEnrollment({
        userId: session.userId,
        organizationId: session.organizationId,
        email: session.email,
        password: operation.password,
      }), requestId);
    }
    if (operation.operation === "confirm") {
      return apiSuccess(await confirmMfaEnrollment({
        userId: session.userId,
        organizationId: session.organizationId,
        code: operation.code,
      }), requestId);
    }
    if (operation.operation === "regenerate_recovery") {
      return apiSuccess(await regenerateRecoveryCodes({
        userId: session.userId,
        organizationId: session.organizationId,
        password: operation.password,
        code: operation.code,
      }), requestId);
    }
    return apiSuccess(await disableMfa({
      userId: session.userId,
      organizationId: session.organizationId,
      password: operation.password,
      code: operation.code,
    }), requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/security/mfa");
  }
}
