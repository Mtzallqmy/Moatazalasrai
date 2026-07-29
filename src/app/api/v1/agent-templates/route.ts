import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentVersions, agents, auditLogs, providerCredentials } from "@/db/schema";
import { agentTemplates, getAgentTemplate } from "@/lib/agents/templates";
import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";

const installSchema = z.object({
  templateId: z.string().trim().min(2).max(80),
  providerCredentialId: z.string().uuid(),
  model: z.string().trim().min(1).max(200),
}).strict();

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "رمز الوصول غير صالح.", requestId);
    requireApiScope(principal, "agents:read");
    return apiSuccess({ templates: agentTemplates }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/agent-templates");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "رمز الوصول غير صالح.", requestId);
    requireApiScope(principal, "agents:write");
    const body = await parseJson(request, installSchema, 12 * 1024);
    const template = getAgentTemplate(body.templateId);
    if (!template) throw new ApiError(404, "AGENT_TEMPLATE_NOT_FOUND", "قالب الوكيل غير موجود.");
    const [credential] = await db().select({
      id: providerCredentials.id,
      models: providerCredentials.discoveredModels,
      enabled: providerCredentials.enabled,
      status: providerCredentials.validationStatus,
    }).from(providerCredentials).where(and(
      eq(providerCredentials.id, body.providerCredentialId),
      eq(providerCredentials.organizationId, principal.organizationId),
    )).limit(1);
    if (!credential || !credential.enabled || credential.status !== "verified" || !credential.models.includes(body.model)) {
      throw new ApiError(422, "PROVIDER_OR_MODEL_UNAVAILABLE", "اختر مزودًا متحققًا ونموذجًا مكتشفًا.");
    }
    const [existing] = await db().select({ id: agents.id }).from(agents).where(and(
      eq(agents.organizationId, principal.organizationId),
      eq(agents.name, template.name),
    )).limit(1);
    if (existing) return apiSuccess({ agent: existing, alreadyInstalled: true }, requestId);

    const result = await db().transaction(async (tx) => {
      const [agent] = await tx.insert(agents).values({
        organizationId: principal.organizationId,
        name: template.name,
        description: template.description,
        status: "published",
        currentVersion: 1,
        defaultProviderCredentialId: credential.id,
        defaultModel: body.model,
      }).returning();
      if (!agent) throw new Error("AGENT_TEMPLATE_INSTALL_FAILED");
      const [version] = await tx.insert(agentVersions).values({
        agentId: agent.id,
        version: 1,
        providerCredentialId: credential.id,
        model: body.model,
        instructions: template.instructions,
        temperatureMilli: Math.round(template.temperature * 1000),
        maxOutputTokens: template.maxOutputTokens,
      }).returning();
      await tx.insert(auditLogs).values({
        organizationId: principal.organizationId,
        actorType: principal.kind,
        actorId: principal.principalId,
        action: "agent_template.installed",
        resourceType: "agent",
        resourceId: agent.id,
        metadata: { requestId, templateId: template.id, model: body.model },
      });
      return { agent, version };
    });
    return apiSuccess({ ...result, alreadyInstalled: false }, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/agent-templates");
  }
}
