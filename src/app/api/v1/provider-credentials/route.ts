import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, providerCredentials } from "@/db/schema";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { defaultBaseUrl, discoverProviderModels } from "@/lib/providers/discovery";
import { encryptSecret, maskSecret } from "@/lib/security/encryption";

type ProviderKind = "openai" | "anthropic" | "gemini" | "openai_compatible";

const providers = new Set<ProviderKind>(["openai", "anthropic", "gemini", "openai_compatible"]);

export async function GET(request: Request) {
  const principal = await authenticateApiKey(request);
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db().select({
    id: providerCredentials.id,
    provider: providerCredentials.provider,
    name: providerCredentials.name,
    baseUrl: providerCredentials.baseUrl,
    secretHint: providerCredentials.secretHint,
    discoveredModels: providerCredentials.discoveredModels,
    validationStatus: providerCredentials.validationStatus,
    lastValidatedAt: providerCredentials.lastValidatedAt,
    enabled: providerCredentials.enabled,
    createdAt: providerCredentials.createdAt,
    updatedAt: providerCredentials.updatedAt,
  }).from(providerCredentials).where(eq(providerCredentials.organizationId, principal.organizationId));
  return NextResponse.json({ credentials: rows });
}

export async function POST(request: Request) {
  const principal = await authenticateApiKey(request);
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    provider?: string;
    name?: string;
    apiKey?: string;
    baseUrl?: string;
  } | null;

  const provider = body?.provider?.trim().toLowerCase() as ProviderKind | undefined;
  const name = body?.name?.trim();
  const apiKey = body?.apiKey?.trim();
  if (!provider || !providers.has(provider) || !name || !apiKey) {
    return NextResponse.json({ error: "provider, name and apiKey are required." }, { status: 400 });
  }

  const requestedBaseUrl = body?.baseUrl?.trim() || defaultBaseUrl(provider);
  if (!requestedBaseUrl) {
    return NextResponse.json({ error: "baseUrl is required for OpenAI-compatible providers." }, { status: 400 });
  }

  try {
    const discovery = await discoverProviderModels({ provider, apiKey, baseUrl: requestedBaseUrl });
    const [created] = await db().insert(providerCredentials).values({
      organizationId: principal.organizationId,
      provider,
      name,
      baseUrl: discovery.normalizedBaseUrl,
      encryptedSecret: encryptSecret(apiKey),
      secretHint: maskSecret(apiKey),
      discoveredModels: discovery.models,
      validationStatus: "verified",
      lastValidatedAt: new Date(),
    }).returning({
      id: providerCredentials.id,
      provider: providerCredentials.provider,
      name: providerCredentials.name,
      baseUrl: providerCredentials.baseUrl,
      secretHint: providerCredentials.secretHint,
      discoveredModels: providerCredentials.discoveredModels,
      validationStatus: providerCredentials.validationStatus,
      lastValidatedAt: providerCredentials.lastValidatedAt,
      enabled: providerCredentials.enabled,
    });

    if (!created) {
      return NextResponse.json({ error: "Could not create provider credential." }, { status: 500 });
    }

    await db().insert(auditLogs).values({
      organizationId: principal.organizationId,
      actorType: "api_key",
      actorId: principal.apiKeyId,
      action: "provider_credential.created",
      resourceType: "provider_credential",
      resourceId: created.id,
      metadata: { provider: created.provider, modelCount: created.discoveredModels.length },
    });
    return NextResponse.json({ credential: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider validation failed.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
