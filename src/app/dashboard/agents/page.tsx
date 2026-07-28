import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AgentManager } from "@/components/agent-manager";
import { DashboardShell } from "@/components/dashboard-shell";
import { db } from "@/db";
import { agentVersions, agents, providerCredentials } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";

export default async function AgentsPage() {
  const session = await currentSession();
  if (!session?.organizationId) redirect("/login");
  const [providers, rows] = await Promise.all([
    db().select({ id: providerCredentials.id, name: providerCredentials.name, provider: providerCredentials.provider, discoveredModels: providerCredentials.discoveredModels }).from(providerCredentials).where(and(eq(providerCredentials.organizationId, session.organizationId), eq(providerCredentials.enabled, true), eq(providerCredentials.validationStatus, "verified"))).orderBy(desc(providerCredentials.updatedAt)),
    db().select({ id: agents.id, name: agents.name, description: agents.description, status: agents.status, model: agentVersions.model, updatedAt: agents.updatedAt }).from(agents).innerJoin(agentVersions, and(eq(agentVersions.agentId, agents.id), eq(agentVersions.version, agents.currentVersion))).where(eq(agents.organizationId, session.organizationId)).orderBy(desc(agents.updatedAt)),
  ]);
  return <DashboardShell session={session} activePath="/dashboard/agents" title="الوكلاء" description="إنشاء ونشر وكلاء حقيقيين مرتبطين بالنماذج المكتشفة من مزوداتك."><AgentManager providers={providers} initialAgents={rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))} /></DashboardShell>;
}
