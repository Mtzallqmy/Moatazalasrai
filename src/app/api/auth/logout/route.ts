import { NextResponse } from "next/server";
import { revokeCurrentSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  await revokeCurrentSession();
  return NextResponse.json({ success: true, data: { loggedOut: true }, meta: { requestId } });
}
