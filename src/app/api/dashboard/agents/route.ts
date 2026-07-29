import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentVersions, agents, auditLogs, providerCredentials } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { agentCreateSchema, agentUpdateSchema, paginationSchema, uuidSchema } from "@/lib/http/contracts";

async function verifiedCredential(organizationId: string, id: string, model: string) {
  const [credential] = await db().select({
    id: providerCredentials.id,
    models: providerCredentials.discoveredModels,
  }).from(providerCredentials).where(and(
    eq(providerCredentials.id, id),
    eq(providerCredentials.organizationId, organizationId),
    eq(providerCredentials.enabled, true),
    eq(providerCredentials.validationStatus, "verified"),
  )).limit(1);
  if (!credential || !credential.models.includes(model)) {
    throw new ApiError(422, "MODEL_UNAVAILABLE", "المزود غير متاح أو النموذج لم يعد ضمن النماذج المكتشفة.");
  }
  return credential;
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("agents:read");
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const agentId = uuidSchema.parse(id);
      const [agent] = await db().select().from(agents).where(and(
        eq(agents.id, agentId),
        eq(agents.organizationId, session.organizationId),
        session.role === "member" ? eq(agents.status, "published") : undefined,
      )).limit(1);
      if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "الوكيل غير موجود.");
      const versions = await db().select({
        id: agentVersions.id,
        version: agentVersions.version,
        providerCredentialId: agentVersions.providerCredentialId,
        model: agentVersions.model,
        instructions: agentVersions.instructions,
        temperatureMilli: agentVersions.temperatureMilli,
        maxOutputTokens: agentVersions.maxOutputTokens,
        createdAt: agentVersions.createdAt,
      }).from(agentVersions).where(eq(agentVersions.agentId, agent.id)).orderBy(desc(agentVersions.version));
      return apiSuccess({ agent, versions }, requestId);
    }

    const query = paginationSchema.parse(Object.fromEntries(url.searchParams));
    const where = and(
      eq(agents.organizationId, session.organizationId),
      session.role === "member" ? eq(agents.status, "published") : undefined,
    );
    const [rows, totals] = await Promise.all([
      db().select({
        id: agents.id,
        name: agents.name,
        description: agents.description,
        status: agents.status,
        currentVersion: agents.currentVersion,
        model: agentVersions.model,
        providerCredentialId: agentVersions.providerCredentialId,
        updatedAt: agents.updatedAt,
      }).from(agents)
        .innerJoin(agentVersions, and(eq(agentVersions.agentId, agents.id), eq(agentVersions.version, agents.currentVersion)))
        .where(where)
        .orderBy(desc(agents.updatedAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      db().select({ value: count() }).from(agents).where(where),
    ]);
    const total = totals[0]?.value ?? 0;
    return apiSuccess(rows, requestId, 200, {
      pagination: { ...query, total, pages: Math.ceil(total / query.limit) },
    });
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/agents");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("agents:manage");
    const body = await parseJson(request, agentCreateSchema, 48 * 1024);
    await verifiedCredential(session.organizationId, body.providerCredentialId, body.model);
    const result = await db().transaction(async (tx) => {
      const [agent] = await tx.insert(agents).values({
        organizationId: session.organizationId,
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
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: body.publish ? "agent.created_and_published" : "agent.created",
        resourceType: "agent",
        resourceId: agent.id,
        metadata: { version: 1, model: body.model, requestId },
      });
      return { agent, version };
    });
    return apiSuccess(result, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/agents");
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("agents:manage");
    const body = await parseJson(request, agentUpdateSchema, 48 * 1024);
    const [current] = await db().select({
      agent: agents,
      version: agentVersions,
    }).from(agents)
      .innerJoin(agentVersions, and(eq(agentVersions.agentId, agents.id), eq(agentVersions.version, agents.currentVersion)))
      .where(and(eq(agents.id, body.id), eq(agents.organizationId, session.organizationId)))
      .limit(1);
    if (!current) throw new ApiError(404, "AGENT_NOT_FOUND", "الوكيل غير موجود.");

    const nextProviderId = body.providerCredentialId ?? current.version.providerCredentialId;
    const nextModel = body.model ?? current.version.model;
    const versionFieldsChanged = [
      body.providerCredentialId,
      body.model,
      body.instructions,
      body.temperature,
      body.maxOutputTokens,
    ].some((value) => value !== undefined);
    const publishing = body.status === "published" && current.agent.status !== "published";
    if (versionFieldsChanged || publishing) {
      await verifiedCredential(session.organizationId, nextProviderId, nextModel);
    }

    const result = await db().transaction(async (tx) => {
      let nextVersion = current.version;
      if (versionFieldsChanged || publishing) {
        const versionNumber = current.agent.currentVersion + 1;
        const [created] = await tx.insert(agentVersions).values({
          agentId: current.agent.id,
          version: versionNumber,
          providerCredentialId: nextProviderId,
          model: nextModel,
          instructions: body.instructions ?? current.version.instructions,
          temperatureMilli: body.temperature === undefined
            ? current.version.temperatureMilli
            : Math.round(body.temperature * 1000),
          maxOutputTokens: body.maxOutputTokens ?? current.version.maxOutputTokens,
        }).returning();
        if (!created) throw new Error("AGENT_VERSION_CREATE_FAILED");
        nextVersion = created;
      }
      const [updated] = await tx.update(agents).set({
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.description === undefined ? {} : { description: body.description || null }),
        ...(body.status === undefined ? {} : { status: body.status }),
        currentVersion: nextVersion.version,
        updatedAt: new Date(),
      }).where(and(eq(agents.id, body.id), eq(agents.organizationId, session.organizationId))).returning();
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: body.status === "published" ? "agent.published" : body.status === "archived" ? "agent.archived" : "agent.updated",
        resourceType: "agent",
        resourceId: body.id,
        metadata: { version: nextVersion.version, status: updated.status, requestId },
      });
      return { agent: updated, version: nextVersion };
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/agents");
  }
}
