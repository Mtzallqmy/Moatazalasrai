import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { executeAgentRun, listOrganizationRuns } from "@/lib/agents/runtime";

export async function GET(request: Request) {
  const principal = await authenticateApiKey(request);
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const runs = await listOrganizationRuns(principal.organizationId, Number.isFinite(limit) ? limit : 50);
  return NextResponse.json({ runs });
}

export async function POST(request: Request) {
  const principal = await authenticateApiKey(request);
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { agentId?: string; input?: string; conversationId?: string } | null;
  if (!body?.agentId || !body.input?.trim()) {
    return NextResponse.json({ error: "agentId and input are required." }, { status: 400 });
  }
  try {
    const run = await executeAgentRun({
      organizationId: principal.organizationId,
      agentId: body.agentId,
      message: body.input.trim(),
      conversationId: body.conversationId,
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Run failed." }, { status: 502 });
  }
}
