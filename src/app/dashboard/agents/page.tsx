import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AgentManager } from "@/components/agent-manager";
import { DashboardShell } from "@/components/dashboard-shell";
import { db } from "@/db";
import { agentVersions, agents, providerCredentials } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/authorization";

export default async function AgentsPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId) redirect("/select-organization");
  if (!session.role) redirect("/select-organization");
  const canManage = can(session.role, "agents:manage");
  const [providers, rows] = await Promise.all([
    canManage ? db().select({ id: providerCredentials.id, name: providerCredentials.name, provider: providerCredentials.provider, discoveredModels: providerCredentials.discoveredModels }).from(providerCredentials).where(and(eq(providerCredentials.organizationId, session.organizationId), eq(providerCredentials.enabled, true), eq(providerCredentials.validationStatus, "verified"))).orderBy(desc(providerCredentials.updatedAt)) : Promise.resolve([]),
    db().select({ id: agents.id, name: agents.name, description: agents.description, status: agents.status, currentVersion: agents.currentVersion, model: agentVersions.model, providerCredentialId: agentVersions.providerCredentialId, updatedAt: agents.updatedAt }).from(agents).innerJoin(agentVersions, and(eq(agentVersions.agentId, agents.id), eq(agentVersions.version, agents.currentVersion))).where(eq(agents.organizationId, session.organizationId)).orderBy(desc(agents.updatedAt)),
  ]);
  return <DashboardShell session={session} activePath="/dashboard/agents" title="الوكلاء" description={canManage ? "مكتبة وكلاء جاهزة، وإنشاء ونشر وكلاء مرتبطين بالنماذج المتحققة." : "استعرض الوكلاء المنشورين واستخدمهم في محادثاتك دون صلاحيات إدارية."}><AgentManager providers={providers} initialAgents={rows.filter((row) => canManage || row.status === "published").map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))} canManage={canManage} /></DashboardShell>;
}
