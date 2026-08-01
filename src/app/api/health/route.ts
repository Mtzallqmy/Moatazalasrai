import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  return NextResponse.json(
    {
      success: true,
      data: {
        status: "ok",
        service: "moataz-agent-platform",
        version: process.env.APP_VERSION?.trim() || process.env.npm_package_version || "unknown",
        features: {
          objectStorage: process.env.OBJECT_STORAGE_DRIVER?.trim().toLowerCase() || "database",
          turnstile: process.env.TURNSTILE_ENABLED === "true",
          aiGateway: process.env.CLOUDFLARE_AI_GATEWAY_ENABLED === "true",
        },
        timestamp: new Date().toISOString(),
      },
      meta: { requestId },
    },
    { headers: { "x-request-id": requestId, "cache-control": "no-store" } }
  );
}
