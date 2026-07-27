import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, providerCredentials } from "@/db/schema";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { encryptSecret, maskSecret } from "@/lib/security/encryption";

const providers = new Set(["openai", "anthropic", "gemini"]);

export async function GET(request: Request) {
  const principal = await authenticateApiKey(request);
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db().select({
    id: providerCredentials.id,
    provider: providerCredentials.provider,
    name: providerCredentials.name,
    secretHint: providerCredentials.secretHint,
    enabled: providerCredentials.enabled,
    createdAt: providerCredentials.createdAt,
    updatedAt: providerCredentials.updatedAt,
  }).from(providerCredentials).where(eq(providerCredentials.organizationId, principal.organizationId));
  return NextResponse.json({ credentials: rows });
}

export async function POST(request: Request) {
  const principal = await authenticateApiKey(request);
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { provider?: string; name?: string; apiKey?: string } | null;
  if (!body?.provider || !providers.has(body.provider) || !body.name?.trim() || !body.apiKey?.trim()) {
    return NextResponse.json({ error: "provider, name and apiKey are required." }, { status: 400 });
  }
  const [created] = await db().insert(providerCredentials).values({
    organizationId: principal.organizationId,
    provider: body.provider as "openai" | "anthropic" | "gemini",
    name: body.name.trim(),
    encryptedSecret: encryptSecret(body.apiKey.trim()),
    secretHint: maskSecret(body.apiKey.trim()),
  }).returning({
    id: providerCredentials.id,
    provider: providerCredentials.provider,
    name: providerCredentials.name,
    secretHint: providerCredentials.secretHint,
    enabled: providerCredentials.enabled,
  });
  await db().insert(auditLogs).values({
    organizationId: principal.organizationId,
    actorType: "api_key",
    actorId: principal.apiKeyId,
    action: "provider_credential.created",
    resourceType: "provider_credential",
    resourceId: created.id,
    metadata: { provider: created.provider },
  });
  return NextResponse.json({ credential: created }, { status: 201 });
}
