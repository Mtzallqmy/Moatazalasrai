import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { can, type Permission, type Role } from "@/lib/auth/permissions";
import { ApiError } from "@/lib/http/api";

export type PlatformActor = {
  userId: string;
  organizationId: string;
  role: Role;
};

export async function actorCan(actor: PlatformActor, permission: Permission) {
  if (can(actor.role, permission)) return true;
  const custom = await loadCustomPermissions(actor.organizationId, actor.userId);
  return custom.includes(permission);
}

export async function assertActorPermission(actor: PlatformActor, permission: Permission) {
  if (!await actorCan(actor, permission)) {
    throw new ApiError(403, "FORBIDDEN", "لا تملك الصلاحية اللازمة لهذا الإجراء.");
  }
}
