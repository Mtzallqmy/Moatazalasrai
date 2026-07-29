import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agentVersions, agents, providerCredentials } from "@/db/schema";
import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { agentCreateSchema } from "@/lib/http/contracts";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "agents:read");
    const rows = await db().select().from(agents)
      .where(eq(agents.organizationId, principal.organizationId))
      .orderBy(desc(agents.updatedAt));
    const linked = rows.length === 0 ? [] : await db().select({
      agentId: agentVersions.agentId,
      version: agentVersions.version,
      model: agentVersions.model,
      provider: providerCredentials.provider,
      providerEnabled: providerCredentials.enabled,
      providerStatus: providerCredentials.validationStatus,
      discoveredModels: providerCredentials.discoveredModels,
      circuitOpenUntil: providerCredentials.circuitOpenUntil,
      lastErrorCode: providerCredentials.lastErrorCode,
    }).from(agentVersions)
      .innerJoin(providerCredentials, eq(providerCredentials.id, agentVersions.providerCredentialId))
      .where(inArray(agentVersions.agentId, rows.map((agent) => agent.id)));
    const runtimeByAgent = new Map(linked.map((entry) => [`${entry.agentId}:${entry.version}`, entry]));
    const now = new Date();
    const safeRows = rows.map((agent) => {
      const runtime = runtimeByAgent.get(`${agent.id}:${agent.currentVersion}`);
      const modelAvailable = runtime?.discoveredModels.includes(runtime.model) ?? false;
      const cooldown = Boolean(runtime?.circuitOpenUntil && runtime.circuitOpenUntil > now);
      const runtimeStatus = !runtime || !runtime.providerEnabled || runtime.providerStatus !== "verified" || !modelAvailable
        ? "unavailable"
        : cooldown ? "cooldown" : "ready";
      return {
        ...agent,
        runtimeStatus,
        runtimeModel: runtime?.model ?? null,
        runtimeProvider: runtime?.provider ?? null,
        runtimeErrorCode: runtime?.lastErrorCode ?? null,
      };
    });
    return apiSuccess({ agents: safeRows }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/agents");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "agents:write");
    const body = await parseJson(request, agentCreateSchema);
    const [credential] = await db().select({
      id: providerCredentials.id,
      enabled: providerCredentials.enabled,
      validationStatus: providerCredentials.validationStatus,
      models: providerCredentials.discoveredModels,
    }).from(providerCredentials).where(and(
      eq(providerCredentials.id, body.providerCredentialId),
      eq(providerCredentials.organizationId, principal.organizationId)
    )).limit(1);
    if (!credential) throw new ApiError(404, "PROVIDER_NOT_FOUND", "اتصال المزود غير موجود.");
    if (!credential.enabled || credential.validationStatus !== "verified" || !credential.models.includes(body.model)) {
      throw new ApiError(422, "PROVIDER_OR_MODEL_UNAVAILABLE", "المزود معطل أو غير متحقق أو النموذج غير متاح.");
    }

    const result = await db().transaction(async (tx) => {
      const [agent] = await tx.insert(agents).values({
        organizationId: principal.organizationId,
        name: body.name,
        description: body.description,
        status: body.publish ? "published" : "draft",
        currentVersion: 1,
      }).returning();
      if (!agent) throw new Error("AGENT_CREATE_FAILED");
      const [version] = await tx.insert(agentVersions).values({
        agentId: agent.id,
        version: 1,
        providerCredentialId: credential.id,
        model: body.model,
        instructions: body.instructions,
        temperatureMilli: Math.round(body.temperature * 1000),
        maxOutputTokens: body.maxOutputTokens,
      }).returning();
      if (!version) throw new Error("AGENT_VERSION_CREATE_FAILED");
      return { agent, version };
    });
    return apiSuccess(result, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/agents");
  }
}
