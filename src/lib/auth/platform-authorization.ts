import { getPostgresPool } from "@/db/pool";
import { currentSession } from "@/lib/auth/session";
import { mfaStatus } from "@/lib/auth/mfa";
import { ApiError } from "@/lib/http/api";

export type PlatformRole = "admin" | "operator";
export type PlatformPermission = "platform:read" | "platform:manage" | "platform:admins:manage" | "platform:secrets:manage";

const permissions: Record<PlatformRole, ReadonlySet<PlatformPermission>> = {
  admin: new Set(["platform:read", "platform:manage", "platform:admins:manage", "platform:secrets:manage"]),
  operator: new Set(["platform:read", "platform:manage"]),
};

const REAUTH_WINDOW_MS = 10 * 60_000;

export type PlatformAuthorizedSession = NonNullable<Awaited<ReturnType<typeof currentSession>>> & {
  platformRole: PlatformRole;
};

async function platformIdentity(userId: string) {
  const result = await getPostgresPool().query<{ role: PlatformRole; active: boolean }>(`
    SELECT role, active
    FROM platform_admins
    WHERE user_id = $1
    LIMIT 1
  `, [userId]);
  return result.rows[0] ?? null;
}

async function sessionReauthenticatedAt(sessionId: string) {
  const result = await getPostgresPool().query<{ reauthenticated_at: Date | null }>(`
    SELECT reauthenticated_at
    FROM sessions
    WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()
    LIMIT 1
  `, [sessionId]);
  return result.rows[0]?.reauthenticated_at ?? null;
}

export async function requirePlatformPermission(
  permission: PlatformPermission,
  options: { requireRecentReauthentication?: boolean } = {},
): Promise<PlatformAuthorizedSession> {
  const session = await currentSession();
  if (!session) throw new ApiError(401, "UNAUTHORIZED", "يجب تسجيل الدخول.");

  const identity = await platformIdentity(session.userId);
  if (!identity?.active || !permissions[identity.role]?.has(permission)) {
    throw new ApiError(403, "PLATFORM_FORBIDDEN", "لا تملك صلاحية منصة لهذا الإجراء.");
  }

  const mfa = await mfaStatus(session.userId);
  if (!mfa.enabled) {
    throw new ApiError(403, "PLATFORM_MFA_REQUIRED", "يجب تفعيل المصادقة متعددة العوامل لحسابات إدارة المنصة.");
  }

  const reauthenticatedAt = await sessionReauthenticatedAt(session.sessionId);
  if (!reauthenticatedAt) {
    throw new ApiError(428, "PLATFORM_MFA_SESSION_REQUIRED", "سجّل الدخول مجددًا وأكمل MFA قبل استخدام صلاحيات المنصة.");
  }
  if (options.requireRecentReauthentication && Date.now() - reauthenticatedAt.getTime() > REAUTH_WINDOW_MS) {
    throw new ApiError(428, "PLATFORM_REAUTH_REQUIRED", "أعد التحقق من كلمة المرور وMFA قبل تنفيذ هذا الإجراء الحساس.");
  }

  return { ...session, platformRole: identity.role };
}

export function requirePlatformAdmin(session: PlatformAuthorizedSession) {
  if (session.platformRole !== "admin") {
    throw new ApiError(403, "PLATFORM_ADMIN_REQUIRED", "يتطلب هذا الإجراء مسؤول منصة.");
  }
  return session;
}

export async function auditPlatformOperation(input: {
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await getPostgresPool().query(`
    INSERT INTO platform_admin_audit_logs
      (actor_user_id, action, resource_type, resource_id, request_id, metadata)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
  `, [
    input.actorUserId,
    input.action,
    input.resourceType,
    input.resourceId ?? null,
    input.requestId ?? null,
    JSON.stringify(input.metadata ?? {}),
  ]);
}
