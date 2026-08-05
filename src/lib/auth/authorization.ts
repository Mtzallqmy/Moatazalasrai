import { currentSession } from "@/lib/auth/session";
import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { ApiError } from "@/lib/http/api";
import { can, type Permission } from "@/lib/auth/permissions";

export { can, permissionsFor } from "@/lib/auth/permissions";
export type { Permission, Role } from "@/lib/auth/permissions";

export async function requireSession(permission?: Permission) {
  const session = await currentSession();
  if (!session) throw new ApiError(401, "UNAUTHORIZED", "يجب تسجيل الدخول.");
  if (!session.organizationId || !session.role) {
    throw new ApiError(409, "ORGANIZATION_REQUIRED", "اختر المؤسسة النشطة أولًا.");
  }
  if (permission && !can(session.role, permission)) {
    const customPermissions = await loadCustomPermissions(session.organizationId, session.userId);
    if (!customPermissions.includes(permission)) {
      throw new ApiError(403, "FORBIDDEN", "لا تملك الصلاحية اللازمة لهذا الإجراء.");
    }
  }
  return session;
}
