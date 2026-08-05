import { and, asc, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { CentralTelegramManager } from "@/components/central-telegram-manager";
import { DashboardShell } from "@/components/dashboard-shell";
import { IntegrationsManager } from "@/components/integrations-manager";
import { db } from "@/db";
import { agents, integrations, organizationMembers, users } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";
import { telegramLinkStatus } from "@/lib/integrations/telegram-platform";

export default async function IntegrationsPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  if (!["owner", "admin"].includes(session.role)) redirect("/forbidden");
  const [publishedAgents, integrationRows, memberRows, telegramStatus] = await Promise.all([
    db().select({ id: agents.id, name: agents.name }).from(agents)
      .where(and(eq(agents.organizationId, session.organizationId), eq(agents.status, "published")))
      .orderBy(desc(agents.updatedAt)),
    db().select({
      id: integrations.id,
      kind: integrations.kind,
      name: integrations.name,
      tokenHint: integrations.tokenHint,
      config: integrations.config,
      status: integrations.status,
      enabled: integrations.enabled,
      lastVerifiedAt: integrations.lastVerifiedAt,
    }).from(integrations).where(eq(integrations.organizationId, session.organizationId))
      .orderBy(desc(integrations.updatedAt)),
    db().select({ id: users.id, name: users.name, email: users.email }).from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, session.organizationId))
      .orderBy(asc(users.name)),
    telegramLinkStatus(session.userId, session.organizationId),
  ]);
  const initialItems = integrationRows.map((row) => ({
    ...row,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    config: row.kind === "telegram"
      ? {
        botUsername: typeof row.config.botUsername === "string" ? row.config.botUsername : undefined,
        agentId: typeof row.config.agentId === "string" ? row.config.agentId : undefined,
        webhookActive: row.config.webhookActive === true,
        deprecated: true,
      }
      : { login: typeof row.config.login === "string" ? row.config.login : undefined },
  }));
  return (
    <DashboardShell
      session={session}
      activePath="/dashboard/integrations"
      title="التكاملات والأدوات"
      description="ربط حسابات المستخدمين ببوت Telegram المركزي وإدارة GitHub مع صلاحيات معزولة لكل مؤسسة."
    >
      <div className="space-y-6">
        <CentralTelegramManager
          initialStatus={telegramStatus}
          currentUserId={session.userId}
          canManage
          members={memberRows.map((member) => ({ ...member, name: member.name ?? member.email }))}
        />
        <IntegrationsManager agents={publishedAgents} initialItems={initialItems} />
      </div>
    </DashboardShell>
  );
}
