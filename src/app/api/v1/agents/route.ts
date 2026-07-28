import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentVersions, agents, providerCredentials } from "@/db/schema";
import { authenticateApiKey } from "@/lib/auth/api-key";

export async function GET(request: Request) {
  const principal = await authenticateApiKey(request);
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db().select().from(agents)
    .where(eq(agents.organizationId, principal.organizationId))
    .orderBy(desc(agents.updatedAt));
  return NextResponse.json({ agents: rows });
}

export async function POST(request: Request) {
  const principal = await authenticateApiKey(request);
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as {
    name?: string;
    description?: string;
    providerCredentialId?: string;
    model?: string;
    instructions?: string;
    maxOutputTokens?: number;
    publish?: boolean;
  } | null;
  if (!body?.name?.trim() || !body.providerCredentialId || !body.model?.trim() || !body.instructions?.trim()) {
    return NextResponse.json({ error: "name, providerCredentialId, model and instructions are required." }, { status: 400 });
  }
  const [credential] = await db().select({ id: providerCredentials.id }).from(providerCredentials).where(and(
    eq(providerCredentials.id, body.providerCredentialId),
    eq(providerCredentials.organizationId, principal.organizationId)
  )).limit(1);
  if (!credential) return NextResponse.json({ error: "Provider credential not found." }, { status: 404 });

  const result = await db().transaction(async (tx) => {
    const [agent] = await tx.insert(agents).values({
      organizationId: principal.organizationId,
      name: body.name!.trim(),
      description: body.description?.trim(),
      status: body.publish ? "published" : "draft",
      currentVersion: 1,
    }).returning();
    const [version] = await tx.insert(agentVersions).values({
      agentId: agent.id,
      version: 1,
      providerCredentialId: credential.id,
      model: body.model!.trim(),
      instructions: body.instructions!.trim(),
      maxOutputTokens: Math.min(Math.max(body.maxOutputTokens ?? 2048, 128), 16384),
    }).returning();
    return { agent, version };
  });
  return NextResponse.json(result, { status: 201 });
}
