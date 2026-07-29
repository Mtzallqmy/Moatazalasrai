import type { memberRole } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";
import { ApiError } from "@/lib/http/api";

export type Role = (typeof memberRole.enumValues)[number];
export type Permission =
  | "providers:read"
  | "providers:manage"
  | "agents:read"
  | "agents:manage"
  | "agents:run"
  | "runs:read"
  | "members:read"
  | "members:manage"
  | "audit:read"
  | "organization:manage"
  | "integrations:read"
  | "integrations:manage"
  | "files:read"
  | "files:upload"
  | "files:manage";

const permissions: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set([
    "providers:read", "providers:manage", "agents:read", "agents:manage", "agents:run",
    "runs:read", "members:read", "members:manage", "audit:read", "organization:manage",
    "integrations:read", "integrations:manage", "files:read", "files:upload", "files:manage",
  ]),
  admin: new Set([
    "providers:read", "providers:manage", "agents:read", "agents:manage", "agents:run",
    "runs:read", "members:read", "members:manage", "audit:read", "organization:manage",
    "integrations:read", "integrations:manage", "files:read", "files:upload", "files:manage",
  ]),
  developer: new Set([
    "providers:read", "providers:manage", "agents:read", "agents:manage", "agents:run", "runs:read",
    "integrations:read", "files:read", "files:upload", "files:manage",
  ]),
  operator: new Set(["providers:read", "agents:read", "agents:run", "runs:read", "integrations:read", "files:read", "files:upload", "files:manage"]),
  viewer: new Set(["providers:read", "agents:read", "runs:read", "integrations:read", "files:read"]),
  member: new Set(["agents:read", "agents:run", "files:read", "files:upload"]),
};

export function can(role: Role, permission: Permission): boolean {
  return permissions[role].has(permission);
}

export async function requireSession(permission?: Permission) {
  const session = await currentSession();
  if (!session) throw new ApiError(401, "UNAUTHORIZED", "يجب تسجيل الدخول.");
  if (!session.organizationId || !session.role) {
    throw new ApiError(409, "ORGANIZATION_REQUIRED", "اختر المؤسسة النشطة أولًا.");
  }
  if (permission && !can(session.role, permission)) {
    throw new ApiError(403, "FORBIDDEN", "لا تملك الصلاحية اللازمة لهذا الإجراء.");
  }
  return session;
}
