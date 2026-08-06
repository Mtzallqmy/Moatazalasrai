import { and, desc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import {
  agentVersions,
  agents,
  auditLogs,
  providerCredentials,
} from "@/db/schema";
import type { Role } from "@/lib/auth/permissions";
import { ApiError } from "@/lib/http/api";
import { agentCreateSchema } from "@/lib/http/contracts";

export type AgentCreateInput = z.infer<typeof agentCreateSchema>;

export async function requireVerifiedProviderModel(input: {
  organizationId: string;
  providerCredentialId: string;
  model: string;
}) {
  const [credential] = await db().select({
    id: providerCredentials.id,
    name: providerCredentials.name,
    models: providerCredentials.discoveredModels,
  }).from(providerCredentials).where(and(
    eq(providerCredentials.id, input.providerCredentialId),
    eq(providerCredentials.organizationId, input.organizationId),
    eq(providerCredentials.enabled, true),
    eq(providerCredentials.validationStatus, "verified"),
    isNull(providerCredentials.deletedAt),
  )).limit(1);
  if (!credential) {
    throw new ApiError(422, "PROVIDER_UNAVAILABLE", "لا يوجد مزود متحقق ومفعل بهذا المعرّف.");
  }
  if (!credential.models.includes(input.model)) {
    throw new ApiError(422, "MODEL_UNAVAILABLE", "النموذج لم يعد ضمن النماذج المكتشفة لهذا المزود.");
  }
  return credential;
}

export async function listVerifiedProviderModels(organizationId: string) {
  const rows = await db().select({
    id: providerCredentials.id,
    name: providerCredentials.name,
    provider: providerCredentials.provider,
    defaultModel: providerCredentials.defaultModel,
    discoveredModels: providerCredentials.discoveredModels,
    allowedModels: providerCredentials.allowedModels,
    updatedAt: providerCredentials.updatedAt,
  }).from(providerCredentials).where(and(
    eq(providerCredentials.organizationId, organizationId),
    eq(providerCredentials.enabled, true),
    eq(providerCredentials.validationStatus, "verified"),
    isNull(providerCredentials.deletedAt),
  )).orderBy(desc(providerCredentials.isDefault), desc(providerCredentials.updatedAt));

  return rows.map((row) => ({
    ...row,
    models: [...new Set([
      ...(row.defaultModel ? [row.defaultModel] : []),
      ...row.allowedModels,
      ...row.discoveredModels,
    ].filter((value): value is string => Boolean(value?.trim())))],
  })).filter((row) => row.models.length > 0);
}

export async function listAccessibleAgents(input: {
  organizationId: string;
  role: Role;
  publishedOnly?: boolean;
  limit?: number;
  offset?: number;
}) {
  const publishedOnly = input.publishedOnly ?? input.role === "member";
  return db().select({
    id: agents.id,
    name: agents.name,
    description: agents.description,
    status: agents.status,
    currentVersion: agents.currentVersion,
    providerCredentialId: agentVersions.providerCredentialId,
    providerName: providerCredentials.name,
    model: agentVersions.model,
    updatedAt: agents.updatedAt,
  }).from(agents)
    .innerJoin(agentVersions, and(
      eq(agentVersions.agentId, agents.id),
      eq(agentVersions.version, agents.currentVersion),
    ))
    .innerJoin(providerCredentials, eq(providerCredentials.id, agentVersions.providerCredentialId))
    .where(and(
      eq(agents.organizationId, input.organizationId),
      publishedOnly ? eq(agents.status, "published") : undefined,
      isNull(providerCredentials.deletedAt),
    ))
    .orderBy(desc(agents.updatedAt), desc(agents.id))
    .limit(Math.min(Math.max(input.limit ?? 25, 1), 100))
    .offset(Math.max(input.offset ?? 0, 0));
}

export async function getAccessibleAgent(input: {
  organizationId: string;
  role: Role;
  agentId: string;
  requirePublished?: boolean;
}) {
  const [agent] = await db().select({
    id: agents.id,
    name: agents.name,
    description: agents.description,
    status: agents.status,
    currentVersion: agents.currentVersion,
    providerCredentialId: agentVersions.providerCredentialId,
    providerName: providerCredentials.name,
    model: agentVersions.model,
    updatedAt: agents.updatedAt,
  }).from(agents)
    .innerJoin(agentVersions, and(
      eq(agentVersions.agentId, agents.id),
      eq(agentVersions.version, agents.currentVersion),
    ))
    .innerJoin(providerCredentials, eq(providerCredentials.id, agentVersions.providerCredentialId))
    .where(and(
      eq(agents.id, input.agentId),
      eq(agents.organizationId, input.organizationId),
      input.requirePublished || input.role === "member" ? eq(agents.status, "published") : undefined,
      eq(providerCredentials.enabled, true),
      eq(providerCredentials.validationStatus, "verified"),
      isNull(providerCredentials.deletedAt),
    )).limit(1);
  if (!agent) {
    throw new ApiError(404, "AGENT_UNAVAILABLE", "الوكيل غير موجود أو غير جاهز للاستخدام.");
  }
  return agent;
}

export async function createAgent(input: {
  organizationId: string;
  actorUserId: string;
  requestId: string;
  values: AgentCreateInput;
}) {
  const values = agentCreateSchema.parse(input.values);
  await requireVerifiedProviderModel({
    organizationId: input.organizationId,
    providerCredentialId: values.providerCredentialId,
    model: values.model,
  });

  return db().transaction(async (tx) => {
    const [agent] = await tx.insert(agents).values({
      organizationId: input.organizationId,
      name: values.name,
      description: values.description || null,
      status: values.publish ? "published" : "draft",
      currentVersion: 1,
      defaultProviderCredentialId: values.providerCredentialId,
      defaultModel: values.model,
    }).returning();
    if (!agent) throw new Error("AGENT_CREATE_FAILED");

    const [version] = await tx.insert(agentVersions).values({
      agentId: agent.id,
      version: 1,
      providerCredentialId: values.providerCredentialId,
      model: values.model,
      instructions: values.instructions,
      temperatureMilli: Math.round(values.temperature * 1000),
      maxOutputTokens: values.maxOutputTokens,
    }).returning();
    if (!version) throw new Error("AGENT_VERSION_CREATE_FAILED");

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.actorUserId,
      action: values.publish ? "agent.created_and_published" : "agent.created",
      resourceType: "agent",
      resourceId: agent.id,
      metadata: {
        version: 1,
        model: values.model,
        source: "application_service",
        requestId: input.requestId,
      },
    });
    return { agent, version };
  });
}
