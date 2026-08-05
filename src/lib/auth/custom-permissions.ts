import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { customRolePermissions, customRoles, memberCustomRoles } from "@/db/control-plane-schema";
import { organizationMembers } from "@/db/schema";
import { ALL_PERMISSIONS, type Permission } from "@/lib/auth/permissions";

const knownPermissions = new Set<string>(ALL_PERMISSIONS);

export async function loadCustomPermissions(organizationId: string, userId: string): Promise<Permission[]> {
  const rows = await db()
    .select({ permission: customRolePermissions.permission })
    .from(organizationMembers)
    .innerJoin(memberCustomRoles, eq(memberCustomRoles.organizationMemberId, organizationMembers.id))
    .innerJoin(customRoles, eq(customRoles.id, memberCustomRoles.roleId))
    .innerJoin(customRolePermissions, eq(customRolePermissions.roleId, customRoles.id))
    .where(and(
      eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.userId, userId),
      eq(memberCustomRoles.organizationId, organizationId),
      eq(customRoles.organizationId, organizationId),
      eq(customRoles.enabled, true),
      isNull(customRoles.deletedAt),
      eq(customRolePermissions.allowed, true),
    ));

  return [...new Set(rows
    .map((row) => row.permission)
    .filter((permission): permission is Permission => knownPermissions.has(permission)))];
}
