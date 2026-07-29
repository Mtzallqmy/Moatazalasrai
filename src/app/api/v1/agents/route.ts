import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentVersions, agents, providerCredentials } from "@/db/schema";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { agentCreateSchema } from "@/lib/http/contracts";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    const rows = await db().select().from(agents)
      .where(eq(agents.organizationId, principal.organizationId))
      .orderBy(desc(agents.updatedAt));
    return apiSuccess({ agents: rows }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/agents");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
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
