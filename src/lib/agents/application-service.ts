import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentVersions, agents, auditLogs, providerCredentials } from "@/db/schema";
import { ApiError } from "@/lib/http/api";

export type AgentCreateInput = {
  name: string;
  description?: string | null;
  instructions: string;
  providerCredentialId: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  publish: boolean;
};

export type AgentActor = {
  userId: string;
  organizationId: string;
  requestId?: string;
};

export async function listVerifiedProviderModels(organizationId: string) {
  const credentials = await db().select({
    id: providerCredentials.id,
    name: providerCredentials.name,
    provider: providerCredentials.provider,
    models: providerCredentials.discoveredModels,
    defaultModel: providerCredentials.defaultModel,
  }).from(providerCredentials).where(and(
    eq(providerCredentials.organizationId, organizationId),
    eq(providerCredentials.enabled, true),
    eq(providerCredentials.validationStatus, "verified"),
  )).orderBy(desc(providerCredentials.updatedAt));
  return credentials.map((credential) => ({
    ...credential,
    models: [...new Set([credential.defaultModel, ...credential.models].filter((value): value is string => Boolean(value)))],
  })).filter((credential) => credential.models.length > 0);
}

export async function assertVerifiedAgentModel(organizationId: string, credentialId: string, model: string) {
  const [credential] = await db().select({
    id: providerCredentials.id,
    models: providerCredentials.discoveredModels,
    defaultModel: providerCredentials.defaultModel,
  }).from(providerCredentials).where(and(
    eq(providerCredentials.id, credentialId),
    eq(providerCredentials.organizationId, organizationId),
    eq(providerCredentials.enabled, true),
    eq(providerCredentials.validationStatus, "verified"),
  )).limit(1);
  const models = credential ? new Set([credential.defaultModel, ...credential.models].filter(Boolean)) : new Set<string>();
  if (!credential || !models.has(model)) {
    throw new ApiError(422, "MODEL_UNAVAILABLE", "المزود غير متاح أو النموذج لم يعد ضمن النماذج المكتشفة.");
  }
  return credential;
}

export async function createAgent(actor: AgentActor, input: AgentCreateInput) {
  await assertVerifiedAgentModel(actor.organizationId, input.providerCredentialId, input.model);
  return db().transaction(async (tx) => {
    const [agent] = await tx.insert(agents).values({
      organizationId: actor.organizationId,
      name: input.name,
      description: input.description?.trim() || null,
      status: input.publish ? "published" : "draft",
      currentVersion: 1,
    }).returning();
    if (!agent) throw new Error("AGENT_CREATE_FAILED");
    const [version] = await tx.insert(agentVersions).values({
      agentId: agent.id,
      version: 1,
      providerCredentialId: input.providerCredentialId,
      model: input.model,
      instructions: input.instructions,
      temperatureMilli: Math.round(input.temperature * 1000),
      maxOutputTokens: input.maxOutputTokens,
    }).returning();
    if (!version) throw new Error("AGENT_VERSION_CREATE_FAILED");
    await tx.insert(auditLogs).values({
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor.userId,
      action: input.publish ? "agent.created_and_published" : "agent.created",
      resourceType: "agent",
      resourceId: agent.id,
      metadata: { version: 1, model: input.model, requestId: actor.requestId ?? null, source: "application-service" },
    });
    return { agent, version };
  });
}
