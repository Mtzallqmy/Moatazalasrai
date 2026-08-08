import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationMembers } from "@/db/schema";
import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { can, type Permission, type Role } from "@/lib/auth/permissions";
import { ApiError } from "@/lib/http/api";
import { activeMembership } from "@/lib/auth/membership-access";

export async function userOrganizationRole(userId: string, organizationId: string): Promise<Role> {
  const [membership] = await db().select({ role: organizationMembers.role }).from(organizationMembers).where(and(
    eq(organizationMembers.userId, userId),
    eq(organizationMembers.organizationId, organizationId),
    activeMembership(),
  )).limit(1);
  if (!membership) throw new ApiError(403, "ORGANIZATION_MEMBERSHIP_REQUIRED", "الحساب لم يعد عضوًا في المؤسسة المحددة.");
  return membership.role;
}

export async function userHasPermission(input: {
  userId: string;
  organizationId: string;
  permission: Permission;
}) {
  const role = await userOrganizationRole(input.userId, input.organizationId);
  if (can(role, input.permission)) return { allowed: true as const, role };
  const customPermissions = await loadCustomPermissions(input.organizationId, input.userId);
  return { allowed: customPermissions.includes(input.permission), role };
}

export async function assertUserPermission(input: {
  userId: string;
  organizationId: string;
  permission: Permission;
}) {
  const result = await userHasPermission(input);
  if (!result.allowed) throw new ApiError(403, "FORBIDDEN", "لا تملك الصلاحية اللازمة لهذا الإجراء.");
  return result.role;
}
