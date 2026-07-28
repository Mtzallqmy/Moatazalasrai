import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/session";
import { defaultBaseUrl, discoverProviderModels } from "@/lib/providers/discovery";

const providers = new Set(["openai", "anthropic", "gemini", "openai_compatible"]);
const writeRoles = new Set(["owner", "admin", "developer"]);

type ProviderKind = "openai" | "anthropic" | "gemini" | "openai_compatible";

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const session = await currentSession();
  if (!session?.organizationId || !session.role) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "يجب تسجيل الدخول.", requestId } }, { status: 401 });
  }
  if (!writeRoles.has(session.role)) {
    return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "لا تملك صلاحية فحص المزود.", requestId } }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as { provider?: string; apiKey?: string; baseUrl?: string } | null;
  const provider = body?.provider?.trim().toLowerCase();
  const apiKey = body?.apiKey?.trim();
  if (!provider || !providers.has(provider) || !apiKey || apiKey.length < 8 || apiKey.length > 1000) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "تحقق من المزود ومفتاح API.", requestId } }, { status: 400 });
  }

  const kind = provider as ProviderKind;
  const baseUrl = body?.baseUrl?.trim() || defaultBaseUrl(kind);
  if (!baseUrl) {
    return NextResponse.json({ success: false, error: { code: "BASE_URL_REQUIRED", message: "أدخل Base URL للمزود المتوافق.", requestId } }, { status: 400 });
  }

  try {
    const result = await discoverProviderModels({ provider: kind, apiKey, baseUrl });
    return NextResponse.json({ success: true, data: result, meta: { requestId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر الاتصال بالمزود.";
    return NextResponse.json({ success: false, error: { code: "PROVIDER_VALIDATION_FAILED", message, requestId } }, { status: 422 });
  }
}
