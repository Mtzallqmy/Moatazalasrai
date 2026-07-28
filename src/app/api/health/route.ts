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
        timestamp: new Date().toISOString(),
      },
      meta: { requestId },
    },
    { headers: { "x-request-id": requestId, "cache-control": "no-store" } }
  );
}
