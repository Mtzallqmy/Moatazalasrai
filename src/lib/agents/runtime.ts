import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentVersions, agents, providerCredentials, runEvents, runs } from "@/db/schema";
import { decryptSecret } from "@/lib/security/encryption";
import { generateText } from "@/lib/ai/model-gateway";

async function appendEvent(runId: string, sequence: number, type: string, payload: Record<string, unknown>) {
  await db().insert(runEvents).values({ runId, sequence, type, payload });
}

export async function executeAgentRun(input: {
  organizationId: string;
  agentId: string;
  message: string;
  conversationId?: string;
}) {
  const [agent] = await db().select().from(agents).where(and(
    eq(agents.id, input.agentId),
    eq(agents.organizationId, input.organizationId)
  )).limit(1);
  if (!agent || agent.status !== "published") throw new Error("Published agent not found.");

  const [version] = await db().select().from(agentVersions)
    .where(and(eq(agentVersions.agentId, agent.id), eq(agentVersions.version, agent.currentVersion)))
    .limit(1);
  if (!version) throw new Error("Agent version not found.");

  const [credential] = await db().select().from(providerCredentials)
    .where(and(eq(providerCredentials.id, version.providerCredentialId), eq(providerCredentials.organizationId, input.organizationId)))
    .limit(1);
  if (!credential || !credential.enabled) throw new Error("Provider credential is unavailable.");

  const [run] = await db().insert(runs).values({
    organizationId: input.organizationId,
    agentId: agent.id,
    agentVersionId: version.id,
    conversationId: input.conversationId,
    status: "running",
    input: input.message,
    provider: credential.provider,
    model: version.model,
    startedAt: new Date(),
  }).returning();

  await appendEvent(run.id, 1, "run.started", { agentId: agent.id, version: version.version });
  try {
    const result = await generateText({
      provider: credential.provider,
      apiKey: decryptSecret(credential.encryptedSecret),
      model: version.model,
      messages: [
        { role: "system", content: version.instructions },
        { role: "user", content: input.message },
      ],
      temperature: version.temperatureMilli / 1000,
      maxOutputTokens: version.maxOutputTokens,
    });
    await appendEvent(run.id, 2, "model.completed", {
      provider: credential.provider,
      model: version.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      requestId: result.rawRequestId,
    });
    const [completed] = await db().update(runs).set({
      status: "completed",
      output: result.text,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      completedAt: new Date(),
    }).where(eq(runs.id, run.id)).returning();
    await appendEvent(run.id, 3, "run.completed", {});
    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown agent runtime error";
    await db().update(runs).set({ status: "failed", error: message, completedAt: new Date() }).where(eq(runs.id, run.id));
    await appendEvent(run.id, 2, "run.failed", { error: message });
    throw new Error(`Agent run failed. Run ID: ${run.id}`);
  }
}

export async function listOrganizationRuns(organizationId: string, limit = 50) {
  return db().select().from(runs).where(eq(runs.organizationId, organizationId)).orderBy(desc(runs.createdAt)).limit(Math.min(limit, 100));
}
