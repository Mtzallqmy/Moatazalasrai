import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversations, messages } from "@/db/schema";
import { executeAgentRun } from "@/lib/agents/runtime";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { chatStreamSchema } from "@/lib/http/contracts";
import { attachmentContext } from "@/lib/storage/attachments";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    const body = await parseJson(request, chatStreamSchema, 64 * 1024);
    const [conversation] = await db().select({
      id: conversations.id,
      agentId: conversations.agentId,
    }).from(conversations).where(and(
      eq(conversations.id, body.conversationId),
      eq(conversations.organizationId, principal.organizationId),
    )).limit(1);
    if (!conversation) return apiFailure(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.", requestId);
    const context = await attachmentContext(principal.organizationId, conversation.id, body.attachmentIds);
    const [userMessage] = await db().insert(messages).values({
      conversationId: conversation.id,
      role: "user",
      content: body.message,
      metadata: { requestId, attachmentIds: body.attachmentIds },
    }).returning({ id: messages.id });
    if (userMessage && body.attachmentIds.length > 0) {
      await db().update(attachments).set({ messageId: userMessage.id }).where(and(
        eq(attachments.organizationId, principal.organizationId),
        inArray(attachments.id, body.attachmentIds),
      ));
    }
    const result = await executeAgentRun({
      organizationId: principal.organizationId,
      agentId: conversation.agentId,
      conversationId: conversation.id,
      message: `${body.message}${context.text}`,
      requestId,
    });
    return apiSuccess({ run: result.run, message: result.assistantMessage }, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/chat");
  }
}
