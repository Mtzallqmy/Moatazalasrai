import { currentSession } from "@/lib/auth/session";
import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { ApiError } from "@/lib/http/api";
import { can, type Permission } from "@/lib/auth/permissions";

export { can, permissionsFor } from "@/lib/auth/permissions";
export type { Permission, Role } from "@/lib/auth/permissions";

type AuthorizedSession = NonNullable<Awaited<ReturnType<typeof currentSession>>> & {
  organizationId: string;
  role: NonNullable<NonNullable<Awaited<ReturnType<typeof currentSession>>>["role"]>;
};

export async function assertSessionPermission(session: AuthorizedSession, permission: Permission) {
  if (can(session.role, permission)) return;
  const customPermissions = await loadCustomPermissions(session.organizationId, session.userId);
  if (!customPermissions.includes(permission)) {
    throw new ApiError(403, "FORBIDDEN", "لا تملك الصلاحية اللازمة لهذا الإجراء.");
  }
}

export async function requireSession(permission?: Permission, timings?: { sessionLatencyMs?: number; permissionLatencyMs?: number }): Promise<AuthorizedSession> {
  const sessionStartedAt = performance.now();
  const session = await currentSession();
  if (timings) timings.sessionLatencyMs = Math.round(performance.now() - sessionStartedAt);
  if (!session) throw new ApiError(401, "UNAUTHORIZED", "يجب تسجيل الدخول.");
  if (!session.organizationId || !session.role) {
    throw new ApiError(409, "ORGANIZATION_REQUIRED", "اختر المؤسسة النشطة أولًا.");
  }
  const authorized = session as AuthorizedSession;
  if (permission) {
    const permissionStartedAt = performance.now();
    await assertSessionPermission(authorized, permission);
    if (timings) timings.permissionLatencyMs = Math.round(performance.now() - permissionStartedAt);
  }
  return authorized;
}
