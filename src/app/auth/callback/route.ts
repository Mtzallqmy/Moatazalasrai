import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureLocalIdentity, supabaseSessionIdFromAccessToken, upsertSupabaseAppSession } from "@/lib/auth/supabase-identity";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = process.env.PUBLIC_APP_URL ?? process.env.APP_URL ?? url.origin;
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?reason=oauth-failed", origin));
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user || !data.session) throw error ?? new Error("AUTH_CALLBACK_FAILED");
    const local = await ensureLocalIdentity(data.user);
    const appSession = await upsertSupabaseAppSession({
      userId: local.id,
      supabaseSessionId: supabaseSessionIdFromAccessToken(data.session.access_token),
      expiresAt: new Date((data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    const next = appSession.organizationSelectionRequired ? "/select-organization" : safeNext(url.searchParams.get("next"));
    return NextResponse.redirect(new URL(next, origin));
  } catch {
    return NextResponse.redirect(new URL("/login?reason=oauth-failed", origin));
  }
}
