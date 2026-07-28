import { and, asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { agents, conversations, messages } from "@/db/schema";
import { executeAgentRun } from "@/lib/agents/runtime";
import { currentSession } from "@/lib/auth/session";

function requestId(request: Request) { return request.headers.get("x-request-id") ?? crypto.randomUUID(); }
function fail(status: number, code: string, message: string, id: string) { return NextResponse.json({ success: false, error: { code, message, requestId: id } }, { status }); }

export async function GET(request: Request) {
  const id = requestId(request);
  const session = await currentSession().catch(() => null);
  if (!session?.organizationId) return fail(401, "UNAUTHORIZED", "يجب تسجيل الدخول.", id);
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId");
  if (!conversationId) {
    const rows = await db().select({ id: conversations.id, title: conversations.title, agentId: conversations.agentId, agentName: agents.name, updatedAt: conversations.updatedAt }).from(conversations).innerJoin(agents, eq(agents.id, conversations.agentId)).where(eq(conversations.organizationId, session.organizationId)).orderBy(desc(conversations.updatedAt)).limit(100);
    return NextResponse.json({ success: true, data: rows, meta: { requestId: id } });
  }
  const [owned] = await db().select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, session.organizationId))).limit(1);
  if (!owned) return fail(404, "NOT_FOUND", "المحادثة غير موجودة.", id);
  const rows = await db().select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt)).limit(200);
  return NextResponse.json({ success: true, data: rows, meta: { requestId: id } });
}

export async function POST(request: Request) {
  const id = requestId(request);
  const session = await currentSession().catch(() => null);
  if (!session?.organizationId) return fail(401, "UNAUTHORIZED", "يجب تسجيل الدخول.", id);
  const body = await request.json().catch(() => null) as { action?: "create" | "send"; agentId?: string; conversationId?: string; message?: string } | null;
  if (body?.action === "create") {
    if (!body.agentId) return fail(400, "VALIDATION_ERROR", "اختر وكيلًا.", id);
    const [agent] = await db().select({ id: agents.id, name: agents.name }).from(agents).where(and(eq(agents.id, body.agentId), eq(agents.organizationId, session.organizationId), eq(agents.status, "published"))).limit(1);
    if (!agent) return fail(422, "AGENT_UNAVAILABLE", "الوكيل غير منشور أو غير موجود.", id);
    const [conversation] = await db().insert(conversations).values({ organizationId: session.organizationId, agentId: agent.id, title: `محادثة مع ${agent.name}` }).returning();
    return NextResponse.json({ success: true, data: conversation, meta: { requestId: id } }, { status: 201 });
  }
  if (body?.action === "send") {
    const text = body.message?.trim();
    if (!body.conversationId || !text || text.length > 30000) return fail(400, "VALIDATION_ERROR", "المحادثة والرسالة مطلوبتان.", id);
    const [conversation] = await db().select({ id: conversations.id, agentId: conversations.agentId }).from(conversations).where(and(eq(conversations.id, body.conversationId), eq(conversations.organizationId, session.organizationId))).limit(1);
    if (!conversation) return fail(404, "NOT_FOUND", "المحادثة غير موجودة.", id);
    const [userMessage] = await db().insert(messages).values({ conversationId: conversation.id, role: "user", content: text }).returning();
    try {
      const run = await executeAgentRun({ organizationId: session.organizationId, agentId: conversation.agentId, message: text, conversationId: conversation.id });
      if (!run?.output) throw new Error("EMPTY_RUN_OUTPUT");
      const [assistantMessage] = await db().insert(messages).values({ conversationId: conversation.id, role: "assistant", content: run.output, metadata: { runId: run.id, model: run.model } }).returning();
      await db().update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
      return NextResponse.json({ success: true, data: { userMessage, assistantMessage, runId: run.id }, meta: { requestId: id } });
    } catch (cause) {
      console.error(JSON.stringify({ event: "chat.run.failed", requestId: id, error: cause instanceof Error ? cause.message : "unknown" }));
      return fail(502, "RUN_FAILED", "تعذر تشغيل الوكيل. راجع صفحة عمليات التشغيل والتشخيص.", id);
    }
  }
  return fail(400, "UNSUPPORTED_ACTION", "الإجراء غير مدعوم.", id);
}
