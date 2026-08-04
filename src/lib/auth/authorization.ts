import { currentSession } from "@/lib/auth/session";
import { assertFreshMfa } from "@/lib/auth/mfa";
import { ApiError } from "@/lib/http/api";
import { can, type Permission } from "@/lib/auth/permissions";
import { recordDeniedAccess } from "@/lib/security/audit";

export { can, permissionsFor } from "@/lib/auth/permissions";
export type { Permission, Role } from "@/lib/auth/permissions";

export async function requireSession(permission?: Permission) {
  const session = await currentSession();
  if (!session) throw new ApiError(401, "UNAUTHORIZED", "يجب تسجيل الدخول.");
  if (!session.organizationId || !session.role) {
    throw new ApiError(409, "ORGANIZATION_REQUIRED", "اختر المؤسسة النشطة أولًا.");
  }
  if (permission && !can(session.role, permission)) {
    await recordDeniedAccess({
      organizationId: session.organizationId,
      actorId: session.userId,
      permission,
      reason: "RBAC_FORBIDDEN",
    });
    throw new ApiError(403, "FORBIDDEN", "لا تملك الصلاحية اللازمة لهذا الإجراء.");
  }
  try {
    await assertFreshMfa({
      userId: session.userId,
      sessionId: session.sessionId,
      role: session.role,
      permission,
    });
  } catch (error) {
    await recordDeniedAccess({
      organizationId: session.organizationId,
      actorId: session.userId,
      permission,
      reason: error instanceof ApiError ? error.code : "MFA_GUARD_FAILED",
    });
    throw error;
  }
  return session;
}
