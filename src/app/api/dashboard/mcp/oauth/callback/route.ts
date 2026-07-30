import { NextResponse } from "next/server";
import { completeHiggsfieldOAuth } from "@/ai/mcp/service";
import { requireSession } from "@/lib/auth/authorization";

function dashboardRedirect(request: Request, status: "connected" | "cancelled" | "failed") {
  const configured = process.env.APP_URL?.trim();
  const url = new URL("/dashboard/mcp", configured || request.url);
  url.searchParams.set("oauth", status);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  try {
    const session = await requireSession("integrations:manage");
    const url = new URL(request.url);
    const serverId = url.searchParams.get("serverId");
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error");
    if (oauthError) return dashboardRedirect(request, "cancelled");
    if (!serverId || !state || !code) return dashboardRedirect(request, "failed");
    await completeHiggsfieldOAuth({
      organizationId: session.organizationId,
      serverId,
      state,
      code,
      origin: url.origin,
    });
    return dashboardRedirect(request, "connected");
  } catch {
    return dashboardRedirect(request, "failed");
  }
}
