import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { IntegrationsManager } from "@/components/integrations-manager";
import { db } from "@/db";
import { agents, integrations } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";

export default async function IntegrationsPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  if (!["owner", "admin"].includes(session.role)) redirect("/forbidden");
  const [publishedAgents, integrationRows] = await Promise.all([
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
      description="اربط Telegram وGitHub بمسار واحد واضح لكل مؤسسة، مع تحقق فعلي قبل اعتبار التكامل جاهزًا."
    >
      <IntegrationsManager agents={publishedAgents} initialItems={initialItems} />
    </DashboardShell>
  );
}
