import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentVersions, agents, auditLogs, providerCredentials } from "@/db/schema";
import { assertActorPermission, type PlatformActor } from "@/lib/auth/actor-authorization";
import { agentCreateSchema } from "@/lib/http/contracts";
import { ApiError } from "@/lib/http/api";

export type AgentCreateInput = Parameters<typeof agentCreateSchema.parse>[0];

async function verifiedCredential(organizationId: string, id: string, model: string) {
  const [credential] = await db().select({
    id: providerCredentials.id,
    name: providerCredentials.name,
    models: providerCredentials.discoveredModels,
  }).from(providerCredentials).where(and(
    eq(providerCredentials.id, id),
    eq(providerCredentials.organizationId, organizationId),
    eq(providerCredentials.enabled, true),
    eq(providerCredentials.validationStatus, "verified"),
  )).limit(1);
  if (!credential) {
    throw new ApiError(422, "PROVIDER_UNAVAILABLE", "المزود غير متاح أو لم يجتز التحقق.");
  }
  if (!credential.models.includes(model)) {
    throw new ApiError(422, "MODEL_UNAVAILABLE", "النموذج غير متاح ضمن النماذج المكتشفة لهذا المزود.");
  }
  return credential;
}

export async function listVerifiedAgentProviders(actor: PlatformActor) {
  await assertActorPermission(actor, "providers:read");
  const rows = await db().select({
    id: providerCredentials.id,
    name: providerCredentials.name,
    provider: providerCredentials.provider,
    defaultModel: providerCredentials.defaultModel,
    discoveredModels: providerCredentials.discoveredModels,
    allowedModels: providerCredentials.allowedModels,
    updatedAt: providerCredentials.updatedAt,
  }).from(providerCredentials).where(and(
    eq(providerCredentials.organizationId, actor.organizationId),
    eq(providerCredentials.enabled, true),
    eq(providerCredentials.validationStatus, "verified"),
  )).orderBy(desc(providerCredentials.isDefault), desc(providerCredentials.updatedAt));
  return rows.map((row) => ({
    ...row,
    models: [...new Set(row.discoveredModels.filter((model) => model.trim().length > 0))],
  })).filter((row) => row.models.length > 0);
}

export async function listAccessibleAgents(input: {
  actor: PlatformActor;
  page?: number;
  limit?: number;
}) {
  await assertActorPermission(input.actor, "agents:read");
  const page = Math.max(1, input.page ?? 1);
  const limit = Math.min(50, Math.max(1, input.limit ?? 10));
  const where = and(
    eq(agents.organizationId, input.actor.organizationId),
    input.actor.role === "member" ? eq(agents.status, "published") : undefined,
  );
  const [rows, totals] = await Promise.all([
    db().select({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      status: agents.status,
      currentVersion: agents.currentVersion,
      providerCredentialId: agentVersions.providerCredentialId,
      providerName: providerCredentials.name,
      providerEnabled: providerCredentials.enabled,
      providerValidationStatus: providerCredentials.validationStatus,
      providerModels: providerCredentials.discoveredModels,
      model: agentVersions.model,
      updatedAt: agents.updatedAt,
    }).from(agents)
      .innerJoin(agentVersions, and(
        eq(agentVersions.agentId, agents.id),
        eq(agentVersions.version, agents.currentVersion),
      ))
      .leftJoin(providerCredentials, eq(providerCredentials.id, agentVersions.providerCredentialId))
      .where(where)
      .orderBy(desc(agents.updatedAt), desc(agents.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db().select({ value: count() }).from(agents).where(where),
  ]);
  const total = Number(totals[0]?.value ?? 0);
  return {
    rows: rows.map((row) => {
      let unavailableReason: string | null = null;
      if (row.status !== "published") unavailableReason = "AGENT_DRAFT";
      else if (!row.providerCredentialId || !row.providerEnabled || row.providerValidationStatus !== "verified") unavailableReason = "PROVIDER_UNAVAILABLE";
      else if (!row.providerModels?.includes(row.model)) unavailableReason = "MODEL_UNAVAILABLE";
      return { ...row, ready: unavailableReason === null, unavailableReason };
    }),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

export async function listRunnableAgents(actor: PlatformActor) {
  await assertActorPermission(actor, "agents:run");
  const result = await listAccessibleAgents({ actor, page: 1, limit: 50 });
  return result.rows.filter((agent) => agent.status === "published" && agent.ready);
}

export async function getAccessibleAgent(actor: PlatformActor, agentId: string) {
  await assertActorPermission(actor, "agents:read");
  const [row] = await db().select({
    id: agents.id,
    name: agents.name,
    description: agents.description,
    status: agents.status,
    currentVersion: agents.currentVersion,
    providerCredentialId: agentVersions.providerCredentialId,
    providerName: providerCredentials.name,
    providerEnabled: providerCredentials.enabled,
    providerValidationStatus: providerCredentials.validationStatus,
    providerModels: providerCredentials.discoveredModels,
    model: agentVersions.model,
    instructions: agentVersions.instructions,
    temperatureMilli: agentVersions.temperatureMilli,
    maxOutputTokens: agentVersions.maxOutputTokens,
    updatedAt: agents.updatedAt,
  }).from(agents)
    .innerJoin(agentVersions, and(
      eq(agentVersions.agentId, agents.id),
      eq(agentVersions.version, agents.currentVersion),
    ))
    .leftJoin(providerCredentials, eq(providerCredentials.id, agentVersions.providerCredentialId))
    .where(and(
      eq(agents.id, agentId),
      eq(agents.organizationId, actor.organizationId),
      actor.role === "member" ? eq(agents.status, "published") : undefined,
    )).limit(1);
  if (!row) throw new ApiError(404, "AGENT_NOT_FOUND", "الوكيل غير موجود.");
  const ready = row.status === "published"
    && Boolean(row.providerCredentialId)
    && row.providerEnabled === true
    && row.providerValidationStatus === "verified"
    && Boolean(row.providerModels?.includes(row.model));
  return { ...row, ready };
}

export async function createAgent(input: {
  actor: PlatformActor;
  data: AgentCreateInput;
  requestId: string;
}) {
  await assertActorPermission(input.actor, "agents:manage");
  const body = agentCreateSchema.parse(input.data);
  await verifiedCredential(input.actor.organizationId, body.providerCredentialId, body.model);
  const result = await db().transaction(async (tx) => {
    const [agent] = await tx.insert(agents).values({
      organizationId: input.actor.organizationId,
      name: body.name,
      description: body.description || null,
      status: body.publish ? "published" : "draft",
      currentVersion: 1,
      defaultProviderCredentialId: body.providerCredentialId,
      defaultModel: body.model,
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
      organizationId: input.actor.organizationId,
      actorType: "user",
      actorId: input.actor.userId,
      action: body.publish ? "agent.created_and_published" : "agent.created",
      resourceType: "agent",
      resourceId: agent.id,
      metadata: { version: 1, model: body.model, requestId: input.requestId, source: "application_service" },
    });
    return { agent, version };
  });
  return getAccessibleAgent(input.actor, result.agent.id);
}
