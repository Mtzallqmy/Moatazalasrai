import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agentMemories, agents, attachments, conversations, messages } from "@/db/schema";
import { aiFeatureEnabled } from "@/ai/config";
import { buildMcpChatContext } from "@/ai/mcp/context";
import { retrieveKnowledge } from "@/ai/rag/retriever";
import { streamAgentRun } from "@/lib/agents/runtime";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { chatStreamSchema } from "@/lib/http/contracts";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { attachmentContext } from "@/lib/storage/attachments";
import { inputKindForAttachments } from "@/server/files/input-kind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function base64Bytes(value: string) {
  return Math.floor(value.length * 0.75);
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("agents:run");
    await enforceRateLimit({ scope: "chat.send", key: `${session.organizationId}:${session.userId}`, limit: 30, windowMs: 60_000 });
    const body = await parseJson(request, chatStreamSchema, 96 * 1024);
    const [conversation] = await db().select({ id: conversations.id, agentId: conversations.agentId })
      .from(conversations)
      .innerJoin(agents, and(eq(agents.id, conversations.agentId), eq(agents.organizationId, session.organizationId)))
      .where(and(
        eq(conversations.id, body.conversationId),
        eq(conversations.organizationId, session.organizationId),
        session.role === "member" ? eq(conversations.createdByUserId, session.userId) : undefined,
        isNull(conversations.archivedAt),
        isNull(conversations.deletedAt),
        eq(agents.status, "published"),
      )).limit(1);
    if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة أو الوكيل غير متاح.");

    const [attachmentData, mcpContext] = await Promise.all([
      attachmentContext(session.organizationId, conversation.id, body.attachmentIds),
      buildMcpChatContext({ organizationId: session.organizationId, userId: session.userId, resources: body.mcpResources, prompt: body.mcpPrompt }),
    ]);
    const imageRows = attachmentData.rows.filter((file) => ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimeType));
    const media = imageRows.map((file) => ({
      type: "image" as const,
      mediaType: file.mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
      data: Buffer.from(file.content).toString("base64"),
    }));
    const combinedMedia = [...media, ...mcpContext.media];
    if (combinedMedia.reduce((sum, item) => sum + (item.type === "image" ? base64Bytes(item.data) : 0), 0) > 20 * 1024 * 1024) {
      throw new ApiError(413, "VISION_PAYLOAD_TOO_LARGE", "إجمالي الصور والمصادر المرسلة للنموذج يتجاوز 20 ميجابايت.");
    }
    const effectiveInputKind = combinedMedia.length > 0
      ? "image"
      : attachmentData.rows.length > 0
        ? inputKindForAttachments(attachmentData.rows.map((file) => file.mimeType))
        : body.inputKind;
    const knowledge = body.knowledgeBaseId && aiFeatureEnabled("RAG")
      ? await retrieveKnowledge({ organizationId: session.organizationId, knowledgeBaseId: body.knowledgeBaseId, query: body.message })
      : { text: "", citations: [] };
    const memoryRows = body.useMemory && aiFeatureEnabled("MEMORY")
      ? await db().select({ content: agentMemories.content }).from(agentMemories).where(and(
        eq(agentMemories.organizationId, session.organizationId),
        eq(agentMemories.userId, session.userId),
        eq(agentMemories.enabled, true),
      )).limit(10)
      : [];
    const memoryText = memoryRows.length ? `\n\n[ذاكرة مصرح بها]\n${memoryRows.map((row) => row.content).join("\n")}` : "";
    if (body.clientRequestId) {
      const [duplicate] = await db().select({ id: messages.id }).from(messages).where(and(
        eq(messages.conversationId, conversation.id),
        eq(messages.clientRequestId, body.clientRequestId),
      )).limit(1);
      if (duplicate) throw new ApiError(409, "DUPLICATE_MESSAGE", "تم استقبال هذه الرسالة سابقًا.");
    }
    const [userMessage] = await db().transaction(async (tx) => {
      const [created] = await tx.insert(messages).values({
        conversationId: conversation.id,
        role: "user",
        content: body.message,
        clientRequestId: body.clientRequestId,
        providerCredentialId: body.providerCredentialId,
        model: body.model,
        metadata: {
          requestId,
          attachmentIds: body.attachmentIds,
          attachments: attachmentData.rows.map((file) => ({ id: file.id, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes, processingStatus: file.processingStatus })),
          mcpReferences: mcpContext.references,
        },
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
        controller.enqueue(encoder.encode(sse("message", {
          userMessage: { ...userMessage, attachments: attachmentData.rows.map((file) => ({
            id: file.id, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes, processingStatus: file.processingStatus,
          })) },
          requestId,
          mcpReferences: mcpContext.references,
        })));
        if (knowledge.citations.length) controller.enqueue(encoder.encode(sse("citations", { citations: knowledge.citations })));
        try {
          for await (const event of streamAgentRun({
            organizationId: session.organizationId,
            userId: session.userId,
            agentId: conversation.agentId,
            conversationId: conversation.id,
            message: `${body.message}${attachmentData.text}${mcpContext.text}${memoryText}${knowledge.text ? `\n\n[سياق معرفة موثق]\n${knowledge.text}` : ""}`,
            requestId,
            requestSignal: request.signal,
            providerCredentialId: body.providerCredentialId,
            model: body.model,
            inputKind: effectiveInputKind,
            media: combinedMedia,
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
