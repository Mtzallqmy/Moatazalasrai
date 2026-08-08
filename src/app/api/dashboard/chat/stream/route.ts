import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agentMemories, agents, attachments, conversations, messages } from "@/db/schema";
import { aiFeatureEnabled } from "@/ai/config";
import { buildMcpChatContext } from "@/ai/mcp/context";
import { retrieveKnowledge } from "@/ai/rag/retriever";
import { streamAgentRun } from "@/lib/agents/runtime";
import { requireSession } from "@/lib/auth/authorization";
import { conversationAccessFilter } from "@/lib/chat/access";
import { ApiError, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { chatStreamSchema } from "@/lib/http/contracts";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { resolveAttachmentContext } from "@/lib/storage/attachment-context-resolver";
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
        conversationAccessFilter({ role: session.role, userId: session.userId, access: "write" }),
        isNull(conversations.archivedAt),
        isNull(conversations.deletedAt),
        eq(agents.status, "published"),
      )).limit(1);
    if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة أو الوكيل غير متاح.");

    const [attachmentData, mcpContext] = await Promise.all([
      resolveAttachmentContext({
        organizationId: session.organizationId,
        conversationId: conversation.id,
        userId: session.userId,
        explicitAttachmentIds: body.attachmentIds,
        userQuery: body.message,
      }),
      buildMcpChatContext({ organizationId: session.organizationId, userId: session.userId, resources: body.mcpResources, prompt: body.mcpPrompt }),
    ]);
    const combinedMedia = [...attachmentData.media, ...mcpContext.media];
    if (combinedMedia.reduce((sum, item) => sum + (item.type === "image" ? base64Bytes(item.data) : 0), 0) > 20 * 1024 * 1024) {
      throw new ApiError(413, "PROVIDER_ATTACHMENT_UNSUPPORTED", "إجمالي الصور والمصادر المرسلة للنموذج يتجاوز الحد الآمن.");
    }
    const effectiveInputKind = combinedMedia.length > 0
      ? "image"
      : attachmentData.attachments.length > 0
        ? inputKindForAttachments(attachmentData.attachments.map((file) => file.mimeType))
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

    const [userMessage] = await db().transaction(async (tx) => {
      const createdAt = new Date();
      const [created] = await tx.insert(messages).values({
        conversationId: conversation.id,
        role: "user",
        authorUserId: session.userId,
        content: body.message,
        contentParts: [{ type: "text", text: body.message }],
        status: "completed",
        requestId,
        completedAt: createdAt,
        clientRequestId: body.clientRequestId,
        providerCredentialId: body.providerCredentialId,
        model: body.model,
        metadata: {
          requestId,
          attachmentIds: body.attachmentIds,
          attachments: attachmentData.attachments.filter((file) => file.explicit).map((file) => ({
            id: file.id, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes, processingStatus: file.status,
          })),
          resolvedAttachmentIds: attachmentData.attachments.map((file) => file.id),
          retrievedAttachmentChunks: attachmentData.retrievedChunkCount,
          mcpReferences: mcpContext.references,
        },
      }).onConflictDoNothing().returning();
      if (!created) throw new ApiError(409, "DUPLICATE_MESSAGE", "تم استقبال هذه الرسالة سابقًا.");
      if (body.attachmentIds.length > 0) {
        await tx.update(attachments).set({ messageId: created.id }).where(and(
          eq(attachments.organizationId, session.organizationId),
          eq(attachments.conversationId, conversation.id),
          inArray(attachments.id, body.attachmentIds),
        ));
      }
      await tx.update(conversations).set({
        providerCredentialId: body.providerCredentialId,
        model: body.model,
        lastMessageAt: createdAt,
        updatedAt: createdAt,
      }).where(and(eq(conversations.id, conversation.id), eq(conversations.organizationId, session.organizationId)));
      return [created];
    });

    console.info(JSON.stringify({
      event: "chat.attachment_context_resolved",
      requestId,
      organizationId: session.organizationId,
      conversationId: conversation.id,
      messageId: userMessage.id,
      providerCredentialId: body.providerCredentialId ?? null,
      model: body.model ?? null,
      attachmentCount: body.attachmentIds.length,
      resolvedAttachmentCount: attachmentData.attachments.length,
      retrievedChunkCount: attachmentData.retrievedChunkCount,
      attachmentContextTokens: attachmentData.contextTokens,
      attachmentStatuses: attachmentData.attachments.map((file) => file.status),
    }));

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(sse("message", {
          userMessage: {
            ...userMessage,
            authorName: session.name,
            authorEmail: session.email,
            attachments: attachmentData.attachments.filter((file) => file.explicit).map((file) => ({
              id: file.id, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes, processingStatus: file.status,
            })),
          },
          requestId,
          mcpReferences: mcpContext.references,
        })));
        if (knowledge.citations.length) controller.enqueue(encoder.encode(sse("citations", { citations: knowledge.citations })));
        if (attachmentData.citations.length) controller.enqueue(encoder.encode(sse("file-citations", { citations: attachmentData.citations })));
        if (attachmentData.attachments.length) controller.enqueue(encoder.encode(sse("attachment-context", {
          resolvedAttachmentCount: attachmentData.attachments.length,
          retrievedChunkCount: attachmentData.retrievedChunkCount,
          attachments: attachmentData.attachments.map(({ id, filename, status, warnings, chunkCount }) => ({ id, filename, status, warnings, chunkCount })),
        })));
        try {
          for await (const event of streamAgentRun({
            organizationId: session.organizationId,
            userId: session.userId,
            conversationAuthorized: true,
            agentId: conversation.agentId,
            conversationId: conversation.id,
            message: `${body.message}${attachmentData.text}${mcpContext.text}${memoryText}${knowledge.text ? `\n\n[سياق معرفة موثق]\n${knowledge.text}` : ""}`,
            requestId,
            requestSignal: request.signal,
            providerCredentialId: body.providerCredentialId,
            model: body.model,
            inputKind: effectiveInputKind,
            media: combinedMedia,
          })) controller.enqueue(encoder.encode(sse(event.type, event)));
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
