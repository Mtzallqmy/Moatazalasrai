import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { issueMobileSession, mobileOrganizations } from "@/lib/auth/mobile";
import {
  markMobileSessionMfaVerified,
  mfaStatusForUser,
  privilegedRole,
  verifyUserMfaCode,
} from "@/lib/auth/mfa";
import { verifyPassword } from "@/lib/auth/password";
import { apiSuccess, ApiError, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { recordAuditEvent, recordDeniedAccess } from "@/lib/security/audit";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(8).max(200),
  organizationId: z.string().uuid().optional(),
  deviceId: z.string().trim().min(8).max(200),
  deviceName: z.string().trim().min(1).max(200).optional(),
  rememberSession: z.boolean().default(true),
  mfaCode: z.string().trim().min(6).max(64).optional(),
}).strict();

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  let actorId: string | null = null;
  try {
    const body = await parseJson(request, schema, 12 * 1024);
    await enforceRateLimit({ scope: "mobile.login.ip", key: requestClientKey(request), limit: 12, windowMs: 15 * 60_000 });
    await enforceRateLimit({ scope: "mobile.login.email", key: body.email, limit: 8, windowMs: 15 * 60_000 });
    const [user] = await db().select().from(users).where(eq(users.email, body.email)).limit(1);
    actorId = user?.id ?? null;
    if (!user?.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
      await recordDeniedAccess({ actorId, reason: "INVALID_CREDENTIALS", requestId, route: "/api/mobile/v1/auth/login" });
      throw new ApiError(401, "INVALID_CREDENTIALS", "بيانات الدخول غير صحيحة.");
    }
    const memberships = await mobileOrganizations(user.id);
    if (memberships.length === 0) throw new ApiError(403, "NO_ORGANIZATION", "لا توجد مساحة عمل مرتبطة بهذا الحساب.");
    const selected = body.organizationId
      ? memberships.find((organization) => organization.id === body.organizationId)
      : memberships.length === 1 ? memberships[0] : null;
    if (!selected) {
      return apiSuccess({
        organizationSelectionRequired: true,
        organizations: memberships,
      }, requestId, 409);
    }

    let mfaMethod: "totp" | "recovery" | null = null;
    if (privilegedRole(selected.role)) {
      const status = await mfaStatusForUser(user.id);
      if (!status.enabled) {
        throw new ApiError(403, "MFA_ENROLLMENT_REQUIRED", "فعّل التحقق الثنائي من واجهة الويب قبل استخدام حساب إداري على الهاتف.");
      }
      if (!body.mfaCode) throw new ApiError(401, "MFA_REQUIRED", "أدخل رمز التحقق الثنائي.");
      mfaMethod = (await verifyUserMfaCode(user.id, body.mfaCode)).method;
    }

    const tokens = await issueMobileSession({
      userId: user.id,
      organizationId: selected.id,
      deviceId: body.deviceId,
      deviceName: body.deviceName,
      rememberSession: body.rememberSession,
    });
    if (mfaMethod) {
      await markMobileSessionMfaVerified({
        userId: user.id,
        mobileSessionId: tokens.sessionId,
        method: mfaMethod,
      });
    }
    await recordAuditEvent({
      organizationId: selected.id,
      actorType: "user",
      actorId: user.id,
      action: "auth.mobile_login",
      resourceType: "mobile_session",
      resourceId: tokens.sessionId,
      metadata: { requestId, role: selected.role, mfaMethod },
    });
    return apiSuccess({
      tokens,
      user: { id: user.id, email: user.email, name: user.name },
      organization: selected,
      mfaVerified: Boolean(mfaMethod),
    }, requestId);
  } catch (error) {
    if (actorId && error instanceof ApiError && error.code.startsWith("MFA_")) {
      await recordDeniedAccess({ actorId, reason: error.code, requestId, route: "/api/mobile/v1/auth/login" });
    }
    return handleApiError(error, requestId, "/api/mobile/v1/auth/login");
  }
}
