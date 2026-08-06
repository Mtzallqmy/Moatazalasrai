import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  agentVersions,
  agents,
  auditLogs,
  providerCredentials,
  type memberRole,
} from "@/db/schema";
import { assertUserPermission, userOrganizationRole } from "@/lib/auth/user-authorization";
import { ApiError } from "@/lib/http/api";
import { agentCreateSchema } from "@/lib/http/contracts";

export type AgentReadinessCode =
  | "ready"
  | "draft"
  | "archived"
  | "provider_missing"
  | "provider_disabled"
  | "provider_unverified"
  | "model_unavailable";

export type ChannelAgentSummary = {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "published" | "archived";
  providerCredentialId: string;
  providerName: string | null;
  model: string;
  updatedAt: Date;
  readiness: AgentReadinessCode;
};

function providerModels(row: {
  defaultModel: string | null;
  allowedModels: string[];
  discoveredModels: string[];
}) {
  return new Set([
    ...(row.defaultModel ? [row.defaultModel] : []),
    ...row.allowedModels,
    ...row.discoveredModels,
  ].map((value) => value.trim()).filter(Boolean));
}

function readiness(row: {
  status: "draft" | "published" | "archived";
  providerCredentialId: string | null;
  providerEnabled: boolean | null;
  validationStatus: "pending" | "verified" | "failed" | null;
  deletedAt: Date | null;
  defaultModel: string | null;
  allowedModels: string[] | null;
  discoveredModels: string[] | null;
  model: string;
}): AgentReadinessCode {
  if (row.status === "draft") return "draft";
  if (row.status === "archived") return "archived";
  if (!row.providerCredentialId || row.deletedAt) return "provider_missing";
  if (!row.providerEnabled) return "provider_disabled";
  if (row.validationStatus !== "verified") return "provider_unverified";
  const models = providerModels({
    defaultModel: row.defaultModel,
    allowedModels: row.allowedModels ?? [],
    discoveredModels: row.discoveredModels ?? [],
  });
  return models.has(row.model) ? "ready" : "model_unavailable";
}

async function agentRows(organizationId: string) {
  return db().select({
    id: agents.id,
    name: agents.name,
    description: agents.description,
    status: agents.status,
    updatedAt: agents.updatedAt,
    providerCredentialId: agentVersions.providerCredentialId,
    model: agentVersions.model,
    providerName: providerCredentials.name,
    providerEnabled: providerCredentials.enabled,
    validationStatus: providerCredentials.validationStatus,
    deletedAt: providerCredentials.deletedAt,
    defaultModel: providerCredentials.defaultModel,
    allowedModels: providerCredentials.allowedModels,
    discoveredModels: providerCredentials.discoveredModels,
  }).from(agents)
    .innerJoin(agentVersions, and(
      eq(agentVersions.agentId, agents.id),
      eq(agentVersions.version, agents.currentVersion),
    ))
    .leftJoin(providerCredentials, and(
      eq(providerCredentials.id, agentVersions.providerCredentialId),
      eq(providerCredentials.organizationId, organizationId),
    ))
    .where(eq(agents.organizationId, organizationId))
    .orderBy(desc(agents.updatedAt));
}

export async function listAccessibleChannelAgents(input: {
  organizationId: string;
  userId: string;
  includeUnavailable?: boolean;
}) {
  const role = await assertUserPermission({ ...input, permission: "agents:read" });
  const rows = await agentRows(input.organizationId);
  return rows
    .filter((row) => role !== "member" || row.status === "published")
    .map((row): ChannelAgentSummary => ({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      providerCredentialId: row.providerCredentialId,
      providerName: row.providerName,
      model: row.model,
      updatedAt: row.updatedAt,
      readiness: readiness(row),
    }))
    .filter((row) => input.includeUnavailable || row.readiness === "ready");
}

export async function getUsableChannelAgent(input: {
  organizationId: string;
  userId: string;
  agentId: string;
}) {
  const agentsForUser = await listAccessibleChannelAgents({
    organizationId: input.organizationId,
    userId: input.userId,
    includeUnavailable: true,
  });
  const agent = agentsForUser.find((item) => item.id === input.agentId);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "الوكيل غير موجود أو غير متاح لهذا المستخدم.");
  if (agent.readiness !== "ready") {
    const messages: Record<AgentReadinessCode, string> = {
      ready: "",
      draft: "الوكيل ما زال مسودة ولا يمكن تشغيله.",
      archived: "الوكيل مؤرشف ولا يمكن تشغيله.",
      provider_missing: "مزود الوكيل غير موجود.",
      provider_disabled: "مزود الوكيل معطل.",
      provider_unverified: "مزود الوكيل غير متحقق.",
      model_unavailable: "نموذج الوكيل غير متاح لدى المزود.",
    };
    throw new ApiError(422, `AGENT_${agent.readiness.toUpperCase()}`, messages[agent.readiness]);
  }
  return agent;
}

export type VerifiedProviderOption = {
  id: string;
  name: string;
  providerTypeId: string;
  models: string[];
  defaultModel: string | null;
};

export async function listVerifiedProviderOptions(input: {
  organizationId: string;
  userId: string;
}) {
  await assertUserPermission({ ...input, permission: "providers:read" });
  const rows = await db().select({
    id: providerCredentials.id,
    name: providerCredentials.name,
    providerTypeId: providerCredentials.providerTypeId,
    defaultModel: providerCredentials.defaultModel,
    allowedModels: providerCredentials.allowedModels,
    discoveredModels: providerCredentials.discoveredModels,
  }).from(providerCredentials).where(and(
    eq(providerCredentials.organizationId, input.organizationId),
    eq(providerCredentials.enabled, true),
    eq(providerCredentials.validationStatus, "verified"),
    isNull(providerCredentials.deletedAt),
  )).orderBy(desc(providerCredentials.isDefault), desc(providerCredentials.updatedAt));
  return rows.map((row): VerifiedProviderOption => ({
    id: row.id,
    name: row.name,
    providerTypeId: row.providerTypeId,
    defaultModel: row.defaultModel,
    models: [...providerModels(row)],
  })).filter((row) => row.models.length > 0);
}

export async function createAgentApplication(input: {
  organizationId: string;
  userId: string;
  data: unknown;
  requestId?: string;
}) {
  await assertUserPermission({ ...input, permission: "agents:manage" });
  const body = agentCreateSchema.parse(input.data);
  const [provider] = await db().select({
    id: providerCredentials.id,
    defaultModel: providerCredentials.defaultModel,
    allowedModels: providerCredentials.allowedModels,
    discoveredModels: providerCredentials.discoveredModels,
  }).from(providerCredentials).where(and(
    eq(providerCredentials.id, body.providerCredentialId),
    eq(providerCredentials.organizationId, input.organizationId),
    eq(providerCredentials.enabled, true),
    eq(providerCredentials.validationStatus, "verified"),
    isNull(providerCredentials.deletedAt),
  )).limit(1);
  if (!provider || !providerModels(provider).has(body.model)) {
    throw new ApiError(422, "MODEL_UNAVAILABLE", "المزود غير متاح أو النموذج لم يعد متاحًا.");
  }

  return db().transaction(async (tx) => {
    const [agent] = await tx.insert(agents).values({
      organizationId: input.organizationId,
      name: body.name,
      description: body.description || null,
      status: body.publish ? "published" : "draft",
      currentVersion: 1,
    }).returning();
    if (!agent) throw new Error("AGENT_CREATE_FAILED");
    const [version] = await tx.insert(agentVersions).values({
      agentId: agent.id,
      version: 1,
      providerCredentialId: body.providerCredentialId,
      model: body.model,
      instructions: body.instructions,
      temperatureMilli: Math.round(body.temperature * 1000),
      maxOutputTokens: body.maxOutputTokens,
    }).returning();
    if (!version) throw new Error("AGENT_VERSION_CREATE_FAILED");
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      action: body.publish ? "agent.created_and_published" : "agent.created",
      resourceType: "agent",
      resourceId: agent.id,
      metadata: {
        source: "channel_client",
        version: 1,
        model: body.model,
        requestId: input.requestId ?? null,
      },
    });
    return { agent, version };
  });
}

export async function currentChannelUserRole(input: { organizationId: string; userId: string }) {
  return userOrganizationRole(input.userId, input.organizationId) as Promise<(typeof memberRole.enumValues)[number]>;
}
