import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { MembersManager } from "@/components/members-manager";
import { db } from "@/db";
import { organizationMembers, organizations, users } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";

export default async function MembersPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  if (!["owner", "admin"].includes(session.role)) redirect("/forbidden");
  const [rows, [organization]] = await Promise.all([db().select({
    id: organizationMembers.id,
    userId: users.id,
    name: users.name,
    email: users.email,
    role: organizationMembers.role,
    expiresAt: organizationMembers.expiresAt,
    customPermissions: organizationMembers.customPermissions,
    createdAt: organizationMembers.createdAt,
  }).from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, session.organizationId))
    .orderBy(asc(organizationMembers.createdAt))
    .limit(100), db().select({ publicRegistrationEnabled: organizations.publicRegistrationEnabled })
      .from(organizations).where(eq(organizations.id, session.organizationId)).limit(1)]);
  return (
    <DashboardShell session={session} activePath="/dashboard/members" title="الأعضاء والصلاحيات" description="إدارة أدوار المؤسسة مع فرض الصلاحيات وعزل الموارد من الباكند.">
      <MembersManager
        initialMembers={rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt?.toISOString() ?? null,
        }))}
        currentUserId={session.userId}
        currentRole={session.role}
        initialPublicRegistrationEnabled={organization?.publicRegistrationEnabled ?? false}
      />
    </DashboardShell>
  );
}
