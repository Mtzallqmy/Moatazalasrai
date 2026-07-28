import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, providerCredentials } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";
import { defaultBaseUrl, discoverProviderModels } from "@/lib/providers/discovery";
import { encryptSecret, maskSecret } from "@/lib/security/encryption";

const providers = new Set(["openai", "anthropic", "gemini", "openai_compatible"]);
const writeRoles = new Set(["owner", "admin", "developer"]);
type ProviderKind = "openai" | "anthropic" | "gemini" | "openai_compatible";

function requestId(request: Request) {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

export async function GET(request: Request) {
  const id = requestId(request);
  const session = await currentSession();
  if (!session?.organizationId) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "يجب تسجيل الدخول.", requestId: id } }, { status: 401 });
  }

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
  }).from(providerCredentials).where(eq(providerCredentials.organizationId, session.organizationId)).orderBy(desc(providerCredentials.createdAt));

  return NextResponse.json({ success: true, data: rows, meta: { requestId: id } });
}

export async function POST(request: Request) {
  const id = requestId(request);
  const session = await currentSession();
  if (!session?.organizationId || !session.role) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "يجب تسجيل الدخول.", requestId: id } }, { status: 401 });
  }
  if (!writeRoles.has(session.role)) {
    return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "لا تملك صلاحية إضافة مزود.", requestId: id } }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as { provider?: string; name?: string; apiKey?: string; baseUrl?: string } | null;
  const provider = body?.provider?.trim().toLowerCase();
  const name = body?.name?.trim();
  const apiKey = body?.apiKey?.trim();
  if (!provider || !providers.has(provider) || !name || name.length > 80 || !apiKey || apiKey.length < 8 || apiKey.length > 1000) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "تحقق من المزود والاسم والمفتاح.", requestId: id } }, { status: 400 });
  }

  const kind = provider as ProviderKind;
  const requestedBaseUrl = body?.baseUrl?.trim() || defaultBaseUrl(kind);
  if (!requestedBaseUrl) {
    return NextResponse.json({ success: false, error: { code: "BASE_URL_REQUIRED", message: "أدخل Base URL للمزود المتوافق.", requestId: id } }, { status: 400 });
  }

  let discovery;
  try {
    discovery = await discoverProviderModels({ provider: kind, apiKey, baseUrl: requestedBaseUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر التحقق من المزود.";
    return NextResponse.json({ success: false, error: { code: "PROVIDER_VALIDATION_FAILED", message, requestId: id } }, { status: 422 });
  }

  const [created] = await db().insert(providerCredentials).values({
    organizationId: session.organizationId,
    provider: kind,
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
    createdAt: providerCredentials.createdAt,
  });

  if (!created) {
    return NextResponse.json({ success: false, error: { code: "CREATE_FAILED", message: "تعذر حفظ بيانات المزود.", requestId: id } }, { status: 500 });
  }

  await db().insert(auditLogs).values({
    organizationId: session.organizationId,
    actorType: "user",
    actorId: session.userId,
    action: "provider_credential.created",
    resourceType: "provider_credential",
    resourceId: created.id,
    metadata: { provider: created.provider, baseUrl: created.baseUrl, modelCount: created.discoveredModels.length },
  });

  return NextResponse.json({ success: true, data: { ...created, validationLatencyMs: discovery.latencyMs }, meta: { requestId: id } }, { status: 201 });
}
