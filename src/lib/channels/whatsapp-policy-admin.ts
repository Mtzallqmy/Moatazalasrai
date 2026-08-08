import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { channelInboxes, channelWorkflows } from "@/db/channel-schema";
import { agents, auditLogs, mcpTools, organizationMembers, providerCredentials, users } from "@/db/schema";
import {
  platformWhatsAppDefaults,
  platformWhatsAppEndpoints,
  whatsappOrganizationPolicies,
  whatsappUserPolicies,
} from "@/db/whatsapp-platform-schema";
import { ApiError } from "@/lib/http/api";
import { ensureOrganizationWhatsAppProjection, resolveEffectiveWhatsAppPolicy } from "./whatsapp-platform";

const uuid = z.string().uuid();
const optionalUuid = uuid.nullable().optional();
const permission = z.enum([
  "ai.chat",
  "agent.use",
  "tools.execute",
  "account.read",
  "conversation.open",
  "tickets.create",
  "orders.read",
  "files.use",
  "search.use",
  "workflows.execute",
  "handoff.request",
]);

const commonPolicy = {
  agentId: optionalUuid,
  providerCredentialId: optionalUuid,
  modelId: z.string().trim().max(200).nullable().optional(),
  teamId: optionalUuid,
  inboxId: optionalUuid,
  workflowId: optionalUuid,
  allowedTools: z.array(uuid).max(200).optional(),
  allowedActions: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  permissions: z.array(permission).max(30).optional(),
  monthlyLimit: z.number().int().min(1).max(100_000_000).nullable().optional(),
  autoReplyEnabled: z.boolean().nullable().optional(),
  humanHandoffEnabled: z.boolean().nullable().optional(),
  memoryEnabled: z.boolean().nullable().optional(),
  filesEnabled: z.boolean().nullable().optional(),
  status: z.enum(["active", "disabled"]).optional(),
  forceHumanHandoff: z.boolean().optional(),
};

export const whatsappPolicyUpdateSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("organization"), ...commonPolicy }).strict(),
  z.object({ scope: z.literal("user"), userId: uuid, ...commonPolicy }).strict(),
]);

export const whatsappPolicyQuerySchema = z.object({
  userId: uuid.optional(),
}).strict();

type PolicyUpdate = z.infer<typeof whatsappPolicyUpdateSchema>;

async function validateReferences(organizationId: string, update: PolicyUpdate) {
  const agentId = update.agentId ?? null;
  const providerId = update.providerCredentialId ?? null;
  const toolIds = update.allowedTools ?? [];
  const inboxId = update.inboxId ?? null;
  const workflowId = update.workflowId ?? null;
  const [agentsFound, providersFound, toolsFound, inboxesFound, workflowsFound] = await Promise.all([
    agentId ? db().select({ id: agents.id }).from(agents).where(and(eq(agents.id, agentId), eq(agents.organizationId, organizationId))).limit(1) : Promise.resolve([]),
    providerId ? db().select({ id: providerCredentials.id }).from(providerCredentials).where(and(
      eq(providerCredentials.id, providerId),
      eq(providerCredentials.organizationId, organizationId),
      eq(providerCredentials.enabled, true),
      eq(providerCredentials.validationStatus, "verified"),
    )).limit(1) : Promise.resolve([]),
    toolIds.length ? db().select({ id: mcpTools.id }).from(mcpTools).where(and(
      eq(mcpTools.organizationId, organizationId),
      inArray(mcpTools.id, toolIds),
      eq(mcpTools.enabled, true),
    )) : Promise.resolve([]),
    inboxId ? db().select({ id: channelInboxes.id }).from(channelInboxes).where(and(
      eq(channelInboxes.id, inboxId),
      eq(channelInboxes.organizationId, organizationId),
    )).limit(1) : Promise.resolve([]),
    workflowId ? db().select({ id: channelWorkflows.id }).from(channelWorkflows).where(and(
      eq(channelWorkflows.id, workflowId),
      eq(channelWorkflows.organizationId, organizationId),
    )).limit(1) : Promise.resolve([]),
  ]);
  if (agentId && agentsFound.length !== 1) throw new ApiError(422, "WHATSAPP_AGENT_INVALID", "الوكيل لا يتبع المؤسسة.");
  if (providerId && providersFound.length !== 1) throw new ApiError(422, "WHATSAPP_PROVIDER_INVALID", "المزود غير متحقق أو لا يتبع المؤسسة.");
  if (toolIds.length && toolsFound.length !== new Set(toolIds).size) throw new ApiError(422, "WHATSAPP_TOOL_INVALID", "إحدى الأدوات غير متاحة للمؤسسة.");
  if (inboxId && inboxesFound.length !== 1) throw new ApiError(422, "WHATSAPP_INBOX_INVALID", "صندوق المحادثات لا يتبع المؤسسة.");
  if (workflowId && workflowsFound.length !== 1) throw new ApiError(422, "WHATSAPP_WORKFLOW_INVALID", "سير العمل لا يتبع المؤسسة.");
  if (update.modelId && !providerId) throw new ApiError(422, "WHATSAPP_MODEL_PROVIDER_REQUIRED", "اختيار النموذج يتطلب مزودًا محددًا.");
  if (update.modelId && providerId) {
    const [provider] = await db().select({ models: providerCredentials.discoveredModels }).from(providerCredentials)
      .where(eq(providerCredentials.id, providerId)).limit(1);
    if (!provider?.models.includes(update.modelId)) throw new ApiError(422, "WHATSAPP_MODEL_INVALID", "النموذج غير متاح في المزود المحدد.");
  }
}

function values(update: PolicyUpdate, actorUserId: string) {
  return {
    ...(update.agentId !== undefined ? { agentId: update.agentId } : {}),
    ...(update.providerCredentialId !== undefined ? { providerCredentialId: update.providerCredentialId } : {}),
    ...(update.modelId !== undefined ? { modelId: update.modelId } : {}),
    ...(update.teamId !== undefined ? { teamId: update.teamId } : {}),
    ...(update.inboxId !== undefined ? { inboxId: update.inboxId } : {}),
    ...(update.workflowId !== undefined ? { workflowId: update.workflowId } : {}),
    ...(update.allowedTools !== undefined ? { allowedTools: update.allowedTools } : {}),
    ...(update.allowedActions !== undefined ? { allowedActions: update.allowedActions } : {}),
    ...(update.permissions !== undefined ? { permissions: update.permissions } : {}),
    ...(update.monthlyLimit !== undefined ? { monthlyLimit: update.monthlyLimit } : {}),
    ...(update.autoReplyEnabled !== undefined ? { autoReplyEnabled: update.autoReplyEnabled } : {}),
    ...(update.humanHandoffEnabled !== undefined ? { humanHandoffEnabled: update.humanHandoffEnabled } : {}),
    ...(update.memoryEnabled !== undefined ? { memoryEnabled: update.memoryEnabled } : {}),
    ...(update.filesEnabled !== undefined ? { filesEnabled: update.filesEnabled } : {}),
    ...(update.status !== undefined ? { status: update.status } : {}),
    ...(update.forceHumanHandoff !== undefined ? { forceHumanHandoff: update.forceHumanHandoff } : {}),
    updatedByUserId: actorUserId,
    updatedAt: new Date(),
  };
}

export async function getWhatsAppPolicyAdministration(input: {
  organizationId: string;
  userId?: string;
}) {
  const [[endpoint], [defaults], [organizationPolicy], userRows, members] = await Promise.all([
    db().select().from(platformWhatsAppEndpoints).where(eq(platformWhatsAppEndpoints.id, "primary")).limit(1),
    db().select().from(platformWhatsAppDefaults).where(eq(platformWhatsAppDefaults.id, "primary")).limit(1),
    db().select().from(whatsappOrganizationPolicies).where(eq(whatsappOrganizationPolicies.organizationId, input.organizationId)).limit(1),
    input.userId ? db().select().from(whatsappUserPolicies).where(and(
      eq(whatsappUserPolicies.organizationId, input.organizationId),
      eq(whatsappUserPolicies.userId, input.userId),
    )).limit(1) : Promise.resolve([]),
    db().select({ id: users.id, name: users.name, email: users.email }).from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, input.organizationId)),
  ]);
  const effective = await resolveEffectiveWhatsAppPolicy({
    organizationId: input.organizationId,
    userId: input.userId ?? null,
  });
  return {
    endpoint: endpoint ? {
      phoneNumberId: endpoint.phoneNumberId,
      businessAccountId: endpoint.businessAccountId,
      displayPhoneNumber: endpoint.displayPhoneNumber,
      credentialSource: endpoint.credentialSource,
      status: endpoint.status,
      lastValidatedAt: endpoint.lastValidatedAt,
    } : null,
    defaults,
    organizationPolicy,
    userPolicy: userRows[0] ?? null,
    effective,
    members,
  };
}

export async function updateWhatsAppPolicy(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  update: PolicyUpdate;
}) {
  await validateReferences(input.organizationId, input.update);
  if (input.update.scope === "user") {
    const [membership] = await db().select({ id: organizationMembers.id }).from(organizationMembers).where(and(
      eq(organizationMembers.organizationId, input.organizationId),
      eq(organizationMembers.userId, input.update.userId),
    )).limit(1);
    if (!membership) throw new ApiError(404, "WHATSAPP_USER_NOT_IN_ORGANIZATION", "المستخدم لا يتبع المؤسسة.");
    const [row] = await db().insert(whatsappUserPolicies).values({
      organizationId: input.organizationId,
      userId: input.update.userId,
      ...values(input.update, input.actorUserId),
    }).onConflictDoUpdate({
      target: [whatsappUserPolicies.organizationId, whatsappUserPolicies.userId],
      set: values(input.update, input.actorUserId),
    }).returning();
    await audit(input, "user", input.update.userId);
    return row;
  }

  const [row] = await db().insert(whatsappOrganizationPolicies).values({
    organizationId: input.organizationId,
    ...values(input.update, input.actorUserId),
  }).onConflictDoUpdate({
    target: whatsappOrganizationPolicies.organizationId,
    set: values(input.update, input.actorUserId),
  }).returning();
  await ensureOrganizationWhatsAppProjection(input.organizationId);
  await audit(input, "organization", input.organizationId);
  return row;
}

async function audit(input: {
  organizationId: string;
  actorUserId: string;
  update: PolicyUpdate;
}, scope: string, resourceId: string) {
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "whatsapp.policy.updated",
    resourceType: `whatsapp_${scope}_policy`,
    resourceId,
    metadata: {
      scope,
      fields: Object.keys(input.update).filter((key) => !["scope", "userId"].includes(key)),
    },
  });
}
