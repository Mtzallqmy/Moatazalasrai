import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  channelConnections,
  channelPermissions,
  type ChannelConnectionSettings,
  type ChannelPermissionName,
} from "@/db/channel-schema";
import { whatsappConnections } from "@/db/schema";
import {
  platformWhatsAppDefaults,
  platformWhatsAppEndpoints,
  whatsappOrganizationPolicies,
  whatsappUserPolicies,
} from "@/db/whatsapp-platform-schema";
import { requireWhatsAppConfig } from "@/lib/integrations/whatsapp/config";
import type { ChannelRoutingPolicy } from "@/lib/channels/types";

const ENDPOINT_ID = "primary";
const SAFE_DEFAULT_PERMISSIONS: ChannelPermissionName[] = [
  "ai.chat",
  "agent.use",
  "conversation.open",
  "handoff.request",
];
const KNOWN_PERMISSIONS = new Set<ChannelPermissionName>([
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

type EffectiveWhatsAppPolicy = {
  organizationId: string;
  userId: string | null;
  agentId: string | null;
  providerCredentialId: string | null;
  modelId: string | null;
  teamId: string | null;
  inboxId: string | null;
  workflowId: string | null;
  allowedTools: string[];
  allowedActions: string[];
  permissions: ChannelPermissionName[];
  monthlyLimit: number | null;
  autoReplyEnabled: boolean;
  humanHandoffEnabled: boolean;
  memoryEnabled: boolean;
  filesEnabled: boolean;
  status: "active" | "disabled";
  forceHumanHandoff: boolean;
};

type PolicyContext = {
  organizationId: string;
  connectionId: string;
  routingPolicy: ChannelRoutingPolicy;
};

const policyContext = new AsyncLocalStorage<PolicyContext>();

function fingerprint(config: ReturnType<typeof requireWhatsAppConfig>) {
  return createHash("sha256").update(JSON.stringify({
    phoneNumberId: config.phoneNumberId,
    businessAccountId: config.businessAccountId,
    displayPhoneNumber: config.displayPhoneNumber,
    accessTokenDigest: createHash("sha256").update(config.accessToken).digest("hex"),
  })).digest("hex");
}

function permissions(values: unknown, fallback: ChannelPermissionName[]) {
  if (!Array.isArray(values)) return fallback;
  const output = values.filter((value): value is ChannelPermissionName =>
    typeof value === "string" && KNOWN_PERMISSIONS.has(value as ChannelPermissionName));
  return output.length ? [...new Set(output)] : fallback;
}

function preferredArray(user: string[] | undefined, organization: string[] | undefined, platform: string[]) {
  if (user?.length) return user;
  if (organization?.length) return organization;
  return platform;
}

export async function synchronizePlatformWhatsAppEndpoint() {
  const config = requireWhatsAppConfig();
  const digest = fingerprint(config);
  const [endpoint] = await db().insert(platformWhatsAppEndpoints).values({
    id: ENDPOINT_ID,
    phoneNumberId: config.phoneNumberId,
    businessAccountId: config.businessAccountId,
    displayPhoneNumber: config.displayPhoneNumber,
    credentialSource: "environment",
    configurationFingerprint: digest,
    status: "healthy",
    lastValidatedAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: platformWhatsAppEndpoints.id,
    set: {
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
      displayPhoneNumber: config.displayPhoneNumber,
      credentialSource: "environment",
      configurationFingerprint: digest,
      status: "healthy",
      lastValidatedAt: new Date(),
      lastErrorCode: null,
      updatedAt: new Date(),
    },
  }).returning();
  await db().insert(platformWhatsAppDefaults).values({ id: ENDPOINT_ID }).onConflictDoNothing();
  return endpoint;
}

export async function resolveWhatsAppSender(waId: string) {
  const [linked] = await db().select({
    organizationId: whatsappConnections.organizationId,
    userId: whatsappConnections.userId,
  }).from(whatsappConnections).where(and(
    eq(whatsappConnections.whatsappWaId, waId),
    eq(whatsappConnections.connectionStatus, "connected"),
  )).limit(1);
  if (linked?.organizationId) {
    return { organizationId: linked.organizationId, userId: linked.userId, linked: true as const };
  }
  const [endpoint] = await db().select({ defaultOrganizationId: platformWhatsAppEndpoints.defaultOrganizationId })
    .from(platformWhatsAppEndpoints).where(eq(platformWhatsAppEndpoints.id, ENDPOINT_ID)).limit(1);
  return endpoint?.defaultOrganizationId
    ? { organizationId: endpoint.defaultOrganizationId, userId: null, linked: false as const }
    : null;
}

export async function ensureOrganizationWhatsAppProjection(organizationId: string) {
  const config = requireWhatsAppConfig();
  const [defaults] = await db().select().from(platformWhatsAppDefaults)
    .where(eq(platformWhatsAppDefaults.id, ENDPOINT_ID)).limit(1);
  const [organizationPolicy] = await db().select().from(whatsappOrganizationPolicies)
    .where(eq(whatsappOrganizationPolicies.organizationId, organizationId)).limit(1);
  const [connection] = await db().insert(channelConnections).values({
    organizationId,
    kind: "whatsapp",
    name: "WhatsApp — قناة المنصة",
    externalAccountId: config.phoneNumberId,
    displayAddress: config.displayPhoneNumber,
    credentialSource: "environment",
    defaultAgentId: organizationPolicy?.agentId ?? defaults?.defaultAgentId ?? null,
    defaultProviderCredentialId: organizationPolicy?.providerCredentialId ?? defaults?.defaultProviderCredentialId ?? null,
    defaultModel: organizationPolicy?.modelId ?? defaults?.defaultModel ?? null,
    inboxId: organizationPolicy?.inboxId ?? null,
    workflowId: organizationPolicy?.workflowId ?? null,
    settings: {
      welcomeMessage: "مرحبًا بك. كيف يمكننا مساعدتك؟",
      autoReplyEnabled: organizationPolicy?.autoReplyEnabled ?? defaults?.autoReplyEnabled ?? true,
      handoffMode: "ai_then_human",
      language: "ar",
      memoryEnabled: organizationPolicy?.memoryEnabled ?? defaults?.memoryEnabled ?? true,
      historyEnabled: true,
      monthlyMessageLimit: organizationPolicy?.monthlyLimit ?? defaults?.monthlyLimit ?? undefined,
      allowedCommands: ["menu", "new", "human", "ai", "status"],
    },
    status: organizationPolicy?.status === "disabled" ? "disabled" : "healthy",
    enabled: organizationPolicy?.status !== "disabled",
    webhookStatus: "central",
    webhookLastVerifiedAt: new Date(),
    lastHealthAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [channelConnections.organizationId, channelConnections.kind, channelConnections.externalAccountId],
    set: {
      name: "WhatsApp — قناة المنصة",
      displayAddress: config.displayPhoneNumber,
      credentialSource: "environment",
      defaultAgentId: organizationPolicy?.agentId ?? defaults?.defaultAgentId ?? null,
      defaultProviderCredentialId: organizationPolicy?.providerCredentialId ?? defaults?.defaultProviderCredentialId ?? null,
      defaultModel: organizationPolicy?.modelId ?? defaults?.defaultModel ?? null,
      inboxId: organizationPolicy?.inboxId ?? null,
      workflowId: organizationPolicy?.workflowId ?? null,
      status: organizationPolicy?.status === "disabled" ? "disabled" : "healthy",
      enabled: organizationPolicy?.status !== "disabled",
      webhookStatus: "central",
      updatedAt: new Date(),
    },
  }).returning();
  if (!connection) throw new Error("WHATSAPP_ORGANIZATION_PROJECTION_FAILED");
  await db().insert(channelPermissions).values({
    connectionId: connection.id,
    organizationId,
    permissions: SAFE_DEFAULT_PERMISSIONS,
    blockedOperations: ["financial", "sensitive"],
    allowedCommands: ["menu", "new", "human", "ai", "status"],
  }).onConflictDoNothing();
  return connection;
}

export async function resolveEffectiveWhatsAppPolicy(input: {
  organizationId: string;
  userId: string | null;
}): Promise<EffectiveWhatsAppPolicy> {
  const [[defaults], [organizationPolicy], userRows] = await Promise.all([
    db().select().from(platformWhatsAppDefaults).where(eq(platformWhatsAppDefaults.id, ENDPOINT_ID)).limit(1),
    db().select().from(whatsappOrganizationPolicies).where(
      eq(whatsappOrganizationPolicies.organizationId, input.organizationId),
    ).limit(1),
    input.userId
      ? db().select().from(whatsappUserPolicies).where(and(
        eq(whatsappUserPolicies.organizationId, input.organizationId),
        eq(whatsappUserPolicies.userId, input.userId),
      )).limit(1)
      : Promise.resolve([]),
  ]);
  const userPolicy = userRows[0];
  const platformPermissions = permissions(defaults?.defaultPermissions, SAFE_DEFAULT_PERMISSIONS);
  const organizationPermissions = permissions(organizationPolicy?.permissions, platformPermissions);
  const effectivePermissions = permissions(userPolicy?.permissions, organizationPermissions);
  const filesEnabled = userPolicy?.filesEnabled ?? organizationPolicy?.filesEnabled ?? defaults?.filesEnabled ?? true;
  const allowedTools = preferredArray(userPolicy?.allowedTools, organizationPolicy?.allowedTools, defaults?.defaultAllowedTools ?? []);
  return {
    organizationId: input.organizationId,
    userId: input.userId,
    agentId: userPolicy?.agentId ?? organizationPolicy?.agentId ?? defaults?.defaultAgentId ?? null,
    providerCredentialId: userPolicy?.providerCredentialId ?? organizationPolicy?.providerCredentialId ?? defaults?.defaultProviderCredentialId ?? null,
    modelId: userPolicy?.modelId ?? organizationPolicy?.modelId ?? defaults?.defaultModel ?? null,
    teamId: userPolicy?.teamId ?? organizationPolicy?.teamId ?? null,
    inboxId: userPolicy?.inboxId ?? organizationPolicy?.inboxId ?? null,
    workflowId: userPolicy?.workflowId ?? organizationPolicy?.workflowId ?? null,
    allowedTools,
    allowedActions: preferredArray(userPolicy?.allowedActions, organizationPolicy?.allowedActions, defaults?.defaultAllowedActions ?? []),
    permissions: filesEnabled ? effectivePermissions : effectivePermissions.filter((value) => value !== "files.use"),
    monthlyLimit: userPolicy?.monthlyLimit ?? organizationPolicy?.monthlyLimit ?? defaults?.monthlyLimit ?? null,
    autoReplyEnabled: userPolicy?.autoReplyEnabled ?? organizationPolicy?.autoReplyEnabled ?? defaults?.autoReplyEnabled ?? true,
    humanHandoffEnabled: userPolicy?.humanHandoffEnabled ?? organizationPolicy?.humanHandoffEnabled ?? defaults?.humanHandoffEnabled ?? true,
    memoryEnabled: userPolicy?.memoryEnabled ?? organizationPolicy?.memoryEnabled ?? defaults?.memoryEnabled ?? true,
    filesEnabled,
    status: userPolicy?.status === "disabled" || organizationPolicy?.status === "disabled" ? "disabled" : "active",
    forceHumanHandoff: userPolicy?.forceHumanHandoff ?? organizationPolicy?.forceHumanHandoff ?? false,
  };
}

export function connectionForWhatsAppPolicy<T extends {
  defaultAgentId: string | null;
  defaultProviderCredentialId: string | null;
  defaultModel: string | null;
  inboxId: string | null;
  workflowId: string | null;
  enabled: boolean;
  status: string;
  settings: ChannelConnectionSettings;
}>(connection: T, policy: EffectiveWhatsAppPolicy): T {
  return {
    ...connection,
    defaultAgentId: policy.agentId,
    defaultProviderCredentialId: policy.providerCredentialId,
    defaultModel: policy.modelId,
    inboxId: policy.inboxId,
    workflowId: policy.workflowId,
    enabled: connection.enabled && policy.status === "active",
    status: policy.status === "active" ? connection.status : "disabled",
    settings: {
      ...connection.settings,
      autoReplyEnabled: policy.autoReplyEnabled,
      memoryEnabled: policy.memoryEnabled,
      monthlyMessageLimit: policy.monthlyLimit ?? undefined,
      handoffMode: policy.forceHumanHandoff ? "human" : connection.settings.handoffMode,
    },
  };
}

export function channelPolicyForWhatsApp(connectionId: string, policy: EffectiveWhatsAppPolicy): ChannelRoutingPolicy {
  return {
    settings: {
      autoReplyEnabled: policy.autoReplyEnabled,
      handoffMode: policy.forceHumanHandoff ? "human" : "ai_then_human",
      memoryEnabled: policy.memoryEnabled,
      historyEnabled: true,
      monthlyMessageLimit: policy.monthlyLimit ?? undefined,
      allowedCommands: ["menu", "new", "human", "ai", "status"],
      language: "ar",
    },
    permissions: new Set(policy.permissions),
    blockedOperations: new Set(["financial", "sensitive"]),
    allowedCommands: new Set(["menu", "new", "human", "ai", "status"]),
    allowedToolIds: policy.permissions.includes("tools.execute") ? policy.allowedTools : [],
  };
}

export function currentWhatsAppChannelPolicy(organizationId: string, connectionId: string) {
  const current = policyContext.getStore();
  return current?.organizationId === organizationId && current.connectionId === connectionId
    ? current.routingPolicy
    : null;
}

export function withWhatsAppChannelPolicy<T>(input: PolicyContext, callback: () => Promise<T>) {
  return policyContext.run(input, callback);
}
