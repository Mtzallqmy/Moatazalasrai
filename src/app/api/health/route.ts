import { NextResponse } from "next/server";

/**
 * Liveness/readiness probe. Deliberately has zero dependencies (no DB call)
 * so it always returns fast, on every platform, even before Neon is wired up.
 * Useful for Railway/Cloudflare/Docker health checks.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "moataz-ai-platform",
    time: new Date().toISOString(),
  });
}
