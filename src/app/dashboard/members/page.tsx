import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { MembersManager } from "@/components/members-manager";
import { db } from "@/db";
import { organizationMembers, users } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";

export default async function MembersPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  if (!["owner", "admin"].includes(session.role)) redirect("/forbidden");
  const rows = await db().select({
    id: organizationMembers.id,
    userId: users.id,
    name: users.name,
    email: users.email,
    role: organizationMembers.role,
    createdAt: organizationMembers.createdAt,
  }).from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, session.organizationId))
    .orderBy(asc(organizationMembers.createdAt))
    .limit(100);
  return (
    <DashboardShell session={session} activePath="/dashboard/members" title="الأعضاء والصلاحيات" description="إدارة أدوار المؤسسة مع فرض الصلاحيات وعزل الموارد من الباكند.">
      <MembersManager initialMembers={rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))} currentUserId={session.userId} currentRole={session.role} />
    </DashboardShell>
  );
}
