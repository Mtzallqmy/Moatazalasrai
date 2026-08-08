// Server page supplies organization-scoped binding options to the channel manager.
import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { channelInboxes, channelWorkflows } from "@/db/channel-schema";
import { agents, mcpTools, organizationMembers, providerCredentials, users } from "@/db/schema";
import { ChannelManager } from "@/components/channel-manager";
import { DashboardShell } from "@/components/dashboard-shell";
import { WhatsAppPolicyManager } from "@/components/whatsapp-policy-manager";
import { currentSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getWhatsAppPolicyAdministration } from "@/lib/channels/whatsapp-policy-admin";

export default async function ChannelsPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.organizationName || !session.role) redirect("/select-organization");
  if (!can(session.role, "channels:read")) redirect("/dashboard");

  const [agentRows, providerRows, toolRows, inboxRows, workflowRows, memberRows, whatsappAdministration] = await Promise.all([
    db().select({ id: agents.id, name: agents.name, status: agents.status }).from(agents).where(and(
      eq(agents.organizationId, session.organizationId),
      eq(agents.status, "published"),
    )).orderBy(asc(agents.name)),
    db().select({
      id: providerCredentials.id,
      name: providerCredentials.name,
      provider: providerCredentials.provider,
      models: providerCredentials.discoveredModels,
      allowedModels: providerCredentials.allowedModels,
      defaultModel: providerCredentials.defaultModel,
      enabled: providerCredentials.enabled,
    }).from(providerCredentials).where(and(
      eq(providerCredentials.organizationId, session.organizationId),
      eq(providerCredentials.validationStatus, "verified"),
      eq(providerCredentials.enabled, true),
    )).orderBy(asc(providerCredentials.name)),
    db().select({ id: mcpTools.id, name: mcpTools.name, title: mcpTools.title, risk: mcpTools.risk }).from(mcpTools).where(and(
      eq(mcpTools.organizationId, session.organizationId),
      eq(mcpTools.enabled, true),
    )).orderBy(asc(mcpTools.name)),
    db().select({ id: channelInboxes.id, name: channelInboxes.name }).from(channelInboxes).where(and(
      eq(channelInboxes.organizationId, session.organizationId),
      eq(channelInboxes.enabled, true),
    )).orderBy(asc(channelInboxes.name)),
    db().select({ id: channelWorkflows.id, name: channelWorkflows.name }).from(channelWorkflows).where(and(
      eq(channelWorkflows.organizationId, session.organizationId),
      eq(channelWorkflows.enabled, true),
    )).orderBy(asc(channelWorkflows.name)),
    db().select({ id: users.id, name: users.name, email: users.email, role: organizationMembers.role }).from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, session.organizationId))
      .orderBy(asc(users.name)),
    getWhatsAppPolicyAdministration({ organizationId: session.organizationId }),
  ]);

  const members = memberRows.map((member) => ({ ...member, name: member.name ?? member.email }));
  const providers = providerRows.map(({ id, name, provider, models, allowedModels, defaultModel, enabled }) => ({
    id,
    name,
    provider,
    enabled,
    defaultModel,
    models: Array.from(new Set([
      ...(defaultModel ? [defaultModel] : []),
      ...allowedModels,
      ...models,
    ].filter(Boolean))),
  }));
  const canManage = can(session.role, "channels:manage");
  const initialWhatsAppData = {
    endpoint: whatsappAdministration.endpoint ? {
      displayPhoneNumber: whatsappAdministration.endpoint.displayPhoneNumber,
      phoneNumberId: whatsappAdministration.endpoint.phoneNumberId,
      businessAccountId: whatsappAdministration.endpoint.businessAccountId,
      credentialSource: whatsappAdministration.endpoint.credentialSource,
      status: whatsappAdministration.endpoint.status,
    } : null,
    effective: whatsappAdministration.effective,
  };

  return (
    <DashboardShell
      session={session}
      activePath="/dashboard/channels"
      title="القنوات وصناديق المحادثات"
      description="إدارة Telegram وقناة WhatsApp المركزية مع توجيه الوكلاء والمزودات والأدوات والصلاحيات والتحويل البشري."
    >
      <div className="space-y-6">
        <WhatsAppPolicyManager
          canManage={canManage}
          initialData={initialWhatsAppData}
          options={{
            agents: agentRows.map(({ id, name }) => ({ id, name })),
            providers,
            tools: toolRows,
            members: members.map(({ id, name, email }) => ({ id, name, email })),
          }}
        />
        <ChannelManager
          canManage={canManage}
          canHandoff={can(session.role, "channels:handoff")}
          options={{
            agents: agentRows,
            providers,
            tools: toolRows,
            inboxes: inboxRows,
            workflows: workflowRows,
            members,
          }}
        />
      </div>
    </DashboardShell>
  );
}
