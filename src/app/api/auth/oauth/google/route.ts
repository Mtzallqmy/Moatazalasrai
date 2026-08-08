import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const origin = process.env.PUBLIC_APP_URL ?? process.env.APP_URL ?? new URL(request.url).origin;
  const redirectTo = new URL("/auth/callback", origin);
  redirectTo.searchParams.set("next", "/dashboard");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: redirectTo.toString(), queryParams: { access_type: "offline", prompt: "select_account" } },
  });
  if (error || !data.url) return NextResponse.redirect(new URL("/login?reason=oauth-failed", origin));
  return NextResponse.redirect(data.url);
}
