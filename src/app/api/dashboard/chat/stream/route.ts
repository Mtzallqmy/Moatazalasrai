import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agents, attachments, conversations, messages } from "@/db/schema";
import { streamAgentRun } from "@/lib/agents/runtime";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { chatStreamSchema } from "@/lib/http/contracts";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { attachmentContext } from "@/lib/storage/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("agents:run");
    await enforceRateLimit({
      scope: "chat.send",
      key: `${session.organizationId}:${session.userId}`,
      limit: 30,
      windowMs: 60_000,
    });
    const body = await parseJson(request, chatStreamSchema, 48 * 1024);
    const [conversation] = await db().select({
      id: conversations.id,
      agentId: conversations.agentId,
    }).from(conversations)
      .innerJoin(agents, and(
        eq(agents.id, conversations.agentId),
        eq(agents.organizationId, session.organizationId),
      ))
      .where(and(
        eq(conversations.id, body.conversationId),
        eq(conversations.organizationId, session.organizationId),
        isNull(conversations.archivedAt),
        eq(agents.status, "published"),
      ))
      .limit(1);
    if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة أو الوكيل غير متاح.");

    const attachmentData = await attachmentContext(
      session.organizationId,
      conversation.id,
      body.attachmentIds,
    );
    const [userMessage] = await db().transaction(async (tx) => {
      const [created] = await tx.insert(messages).values({
        conversationId: conversation.id,
        role: "user",
        content: body.message,
        metadata: { requestId, attachmentIds: body.attachmentIds },
      }).returning();
      if (created && body.attachmentIds.length > 0) {
        await tx.update(attachments).set({ messageId: created.id }).where(and(
          eq(attachments.organizationId, session.organizationId),
          inArray(attachments.id, body.attachmentIds),
        ));
      }
      return [created];
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(sse("message", { userMessage, requestId })));
        try {
          for await (const event of streamAgentRun({
            organizationId: session.organizationId,
            agentId: conversation.agentId,
            conversationId: conversation.id,
            message: `${body.message}${attachmentData.text}`,
            requestId,
            requestSignal: request.signal,
          })) {
            controller.enqueue(encoder.encode(sse(event.type, event)));
          }
        } catch (error) {
          const response = handleApiError(error, requestId, "/api/dashboard/chat/stream");
          const payload = await response.json();
          controller.enqueue(encoder.encode(sse("error", payload.error)));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/chat/stream");
  }
}
