import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { databaseRows } from "@/db/result";
import { ALL_PERMISSIONS, type Permission } from "@/lib/auth/permissions";

const knownPermissions = new Set<string>(ALL_PERMISSIONS);

const resolveCustomPermissions = cache(async (organizationId: string, userId: string): Promise<Permission[]> => {
  const result = await db().execute(sql`
    SELECT DISTINCT permission
    FROM (
      SELECT jsonb_array_elements_text(COALESCE(om.custom_permissions, '[]'::jsonb)) AS permission
      FROM organization_members om
      WHERE om.organization_id = ${organizationId} AND om.user_id = ${userId}
      UNION ALL
      SELECT crp.permission
      FROM organization_members om
      INNER JOIN member_custom_roles mcr ON mcr.organization_member_id = om.id
      INNER JOIN custom_roles cr ON cr.id = mcr.role_id
      INNER JOIN custom_role_permissions crp ON crp.role_id = cr.id
      WHERE om.organization_id = ${organizationId}
        AND om.user_id = ${userId}
        AND mcr.organization_id = ${organizationId}
        AND cr.organization_id = ${organizationId}
        AND cr.enabled = true
        AND cr.deleted_at IS NULL
        AND crp.allowed = true
    ) resolved_permissions
  `);
  return databaseRows(result)
    .map((row) => row.permission)
    .filter((permission): permission is Permission => typeof permission === "string" && knownPermissions.has(permission));
});

export function loadCustomPermissions(organizationId: string, userId: string): Promise<Permission[]> {
  return resolveCustomPermissions(organizationId, userId);
}
