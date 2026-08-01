import { NextResponse } from "next/server";
import { checkDatabase } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const database = await checkDatabase();
    return NextResponse.json(
      {
        success: true,
        data: {
          status: "ready",
          version: process.env.APP_VERSION?.trim() || process.env.npm_package_version || "unknown",
          checks: { database },
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
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SERVICE_NOT_READY",
          message: "The service cannot reach a required dependency.",
          details: [{ dependency: "database", status: "unavailable" }],
          requestId,
        },
      },
      { status: 503, headers: { "x-request-id": requestId, "cache-control": "no-store" } }
    );
  }
}
