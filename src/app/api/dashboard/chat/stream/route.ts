import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { runWithDatabaseQueryMetrics } from "@/db/query-observability";
import { agentMemories, agents, attachments, conversations, messages } from "@/db/schema";
import { aiFeatureEnabled } from "@/ai/config";
import { buildMcpChatContext } from "@/ai/mcp/context";
import { retrieveKnowledge } from "@/ai/rag/retriever";
import { streamAgentRun } from "@/lib/agents/runtime";
import { requireSession } from "@/lib/auth/authorization";
import { conversationAccessFilter } from "@/lib/chat/access";
import { ApiError, assertSameOrigin, completeRequestTiming, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
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
  return runWithDatabaseQueryMetrics(async (queryMetrics) => {
  const routeStartedAt = performance.now();
  const requestId = getRequestId(request);
  const authTimings: { sessionLatencyMs?: number; permissionLatencyMs?: number } = {};
  let conversationLookupMs: number | null = null;
  try {
    assertSameOrigin(request);
    const [session, body] = await Promise.all([
      requireSession("agents:run", authTimings),
      parseJson(request, chatStreamSchema, 96 * 1024),
    ]);
    const conversationPromise = (async () => {
      const conversationStartedAt = performance.now();
      try {
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
        return conversation;
      } finally {
        conversationLookupMs = Math.round(performance.now() - conversationStartedAt);
      }
    })();
    const [conversation] = await Promise.all([
      conversationPromise,
      enforceRateLimit({ scope: "chat.send", key: `${session.organizationId}:${session.userId}`, limit: 30, windowMs: 60_000 }),
    ]);
    if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة أو الوكيل غير متاح.");

    const encoder = new TextEncoder();
    const streamStartedAt = performance.now();
    let contextDurationMs: number | null = null;
    let providerConnectMs: number | null = null;
    let providerFirstTokenMs: number | null = null;
    let attachmentContextMs: number | null = null;
    let ragLatencyMs: number | null = null;
    let memoryLatencyMs: number | null = null;
    let mcpLatencyMs: number | null = null;
    let streamFailed = false;
    const streamAbort = new AbortController();
    const abortFromRequest = () => streamAbort.abort(request.signal.reason);
    request.signal.addEventListener("abort", abortFromRequest, { once: true });
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(sse("status", { stage: "preparing", message: "جارٍ تجهيز سياق المحادثة…" })));
          const contextStartedAt = performance.now();
          const measured = async <T,>(task: Promise<T>, record: (durationMs: number) => void) => {
            const startedAt = performance.now();
            try { return await task; }
            finally { record(Math.round(performance.now() - startedAt)); }
          };
          const [attachmentData, mcpContext, knowledge, memoryRows] = await Promise.all([
            measured(resolveAttachmentContext({
              organizationId: session.organizationId,
              conversationId: conversation.id,
              userId: session.userId,
              explicitAttachmentIds: body.attachmentIds,
              userQuery: body.message,
            }), (value) => { attachmentContextMs = value; }),
            measured(buildMcpChatContext({ organizationId: session.organizationId, userId: session.userId, resources: body.mcpResources, prompt: body.mcpPrompt }), (value) => { mcpLatencyMs = value; }),
            body.knowledgeBaseId && aiFeatureEnabled("RAG")
              ? measured(retrieveKnowledge({ organizationId: session.organizationId, knowledgeBaseId: body.knowledgeBaseId, query: body.message }), (value) => { ragLatencyMs = value; })
              : Promise.resolve({ text: "", citations: [] }),
            body.useMemory && aiFeatureEnabled("MEMORY")
              ? measured(db().select({ content: agentMemories.content }).from(agentMemories).where(and(
                eq(agentMemories.organizationId, session.organizationId),
                eq(agentMemories.userId, session.userId),
                eq(agentMemories.enabled, true),
              )).limit(10), (value) => { memoryLatencyMs = value; })
              : Promise.resolve([]),
          ]);
          contextDurationMs = Math.round(performance.now() - contextStartedAt);
          const combinedMedia = [...attachmentData.media, ...mcpContext.media];
          if (combinedMedia.reduce((sum, item) => sum + (item.type === "image" ? base64Bytes(item.data) : 0), 0) > 20 * 1024 * 1024) {
            throw new ApiError(413, "PROVIDER_ATTACHMENT_UNSUPPORTED", "إجمالي الصور والمصادر المرسلة للنموذج يتجاوز الحد الآمن.");
          }
          const effectiveInputKind = combinedMedia.length > 0
            ? "image"
            : attachmentData.attachments.length > 0
              ? inputKindForAttachments(attachmentData.attachments.map((file) => file.mimeType))
              : body.inputKind;
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
            event: "chat.attachment_context_resolved", requestId, organizationId: session.organizationId,
            conversationId: conversation.id, messageId: userMessage.id,
            providerCredentialId: body.providerCredentialId ?? null, model: body.model ?? null,
            attachmentCount: body.attachmentIds.length, resolvedAttachmentCount: attachmentData.attachments.length,
            retrievedChunkCount: attachmentData.retrievedChunkCount, attachmentContextTokens: attachmentData.contextTokens,
            attachmentStatuses: attachmentData.attachments.map((file) => file.status),
          }));
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
          controller.enqueue(encoder.encode(sse("status", { stage: "generating", message: "يتولى الوكيل الذكي إنشاء الرد…" })));
          const providerStartedAt = performance.now();
          for await (const event of streamAgentRun({
            organizationId: session.organizationId,
            userId: session.userId,
            conversationAuthorized: true,
            agentId: conversation.agentId,
            conversationId: conversation.id,
            message: `${body.message}${attachmentData.text}${mcpContext.text}${memoryText}${knowledge.text ? `\n\n[سياق معرفة موثق]\n${knowledge.text}` : ""}`,
            requestId,
            requestSignal: streamAbort.signal,
            providerCredentialId: body.providerCredentialId,
            model: body.model,
            inputKind: effectiveInputKind,
            media: combinedMedia,
          })) {
            if (providerConnectMs === null) providerConnectMs = Math.round(performance.now() - providerStartedAt);
            if (providerFirstTokenMs === null && event.type === "delta") providerFirstTokenMs = Math.round(performance.now() - providerStartedAt);
            controller.enqueue(encoder.encode(sse(event.type, event)));
          }
        } catch (error) {
          streamFailed = true;
          if (!streamAbort.signal.aborted) {
            const response = handleApiError(error, requestId, "/api/dashboard/chat/stream");
            const payload = await response.json();
            controller.enqueue(encoder.encode(sse("error", payload.error)));
          }
        } finally {
          const streamDurationMs = Math.round(performance.now() - streamStartedAt);
          console.info(JSON.stringify({
            level: streamFailed ? "warn" : "info",
            event: "chat.stream.completed",
            requestId,
            status: streamAbort.signal.aborted ? "cancelled" : streamFailed ? "error" : "ok",
            contextDurationMs,
            sessionLatencyMs: authTimings.sessionLatencyMs ?? null,
            permissionLatencyMs: authTimings.permissionLatencyMs ?? null,
            conversationLookupMs,
            attachmentContextMs,
            ragLatencyMs,
            memoryLatencyMs,
            mcpLatencyMs,
            providerConnectMs,
            providerFirstTokenMs,
            streamDurationMs,
            dbQueryCount: queryMetrics.count,
          }));
          if (!streamFailed) completeRequestTiming(requestId, 200, {
            sessionLatencyMs: authTimings.sessionLatencyMs ?? null,
            permissionLatencyMs: authTimings.permissionLatencyMs ?? null,
            conversationLookupMs,
            attachmentContextMs,
            ragLatencyMs,
            memoryLatencyMs,
            mcpLatencyMs,
            providerConnectMs,
            providerFirstTokenMs,
            streamDurationMs,
            dbQueryCount: queryMetrics.count,
          });
          request.signal.removeEventListener("abort", abortFromRequest);
          try { controller.close(); } catch { /* The consumer cancelled the stream. */ }
        }
      },
      cancel() {
        streamAbort.abort(new DOMException("Stream cancelled", "AbortError"));
      },
    });

    const routeSetupMs = Math.round(performance.now() - routeStartedAt);
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-request-id": requestId,
        "server-timing": `route;dur=${routeSetupMs}`,
      },
    });
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/chat/stream");
  }
  });
}
