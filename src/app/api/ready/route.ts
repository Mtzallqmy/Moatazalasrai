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
          checks: { database },
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
