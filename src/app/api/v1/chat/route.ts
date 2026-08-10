import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversations, messages } from "@/db/schema";
import { buildMcpChatContext } from "@/ai/mcp/context";
import { executeAgentRun } from "@/lib/agents/runtime";
import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { apiFailure, apiSuccess, ApiError, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { chatStreamSchema } from "@/lib/http/contracts";
import { attachmentContext } from "@/lib/storage/attachments";
import { inputKindForAttachments } from "@/server/files/input-kind";

function base64Bytes(value: string) {
  return Math.floor(value.length * 0.75);
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "chat:write");
    const body = await parseJson(request, chatStreamSchema, 96 * 1024);
    const [conversation] = await db().select({ id: conversations.id, agentId: conversations.agentId })
      .from(conversations).where(and(
        eq(conversations.id, body.conversationId),
        eq(conversations.organizationId, principal.organizationId),
        principal.userId ? eq(conversations.createdByUserId, principal.userId) : undefined,
      )).limit(1);
    if (!conversation) return apiFailure(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.", requestId);

    const [context, mcpContext] = await Promise.all([
      attachmentContext(principal.organizationId, conversation.id, body.attachmentIds),
      buildMcpChatContext({
        organizationId: principal.organizationId,
        userId: principal.userId,
        resources: body.mcpResources,
        prompt: body.mcpPrompt,
        signal: request.signal,
      }),
    ]);
    const media = context.rows.filter((file) => ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimeType)).map((file) => ({
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
      : context.rows.length > 0
        ? inputKindForAttachments(context.rows.map((file) => file.mimeType))
        : body.inputKind;
    const [userMessage] = await db().insert(messages).values({
      conversationId: conversation.id,
      role: "user",
      authorUserId: principal.userId,
      content: body.message,
      metadata: {
        requestId,
        attachmentIds: body.attachmentIds,
        mcpReferences: mcpContext.references,
        requestedProviderCredentialId: body.providerCredentialId ?? null,
        requestedModel: body.model ?? null,
      },
    }).returning({ id: messages.id });
    if (userMessage && body.attachmentIds.length > 0) {
      await db().update(attachments).set({ messageId: userMessage.id }).where(and(
        eq(attachments.organizationId, principal.organizationId),
        inArray(attachments.id, body.attachmentIds),
      ));
    }
    const result = await executeAgentRun({
      organizationId: principal.organizationId,
      userId: principal.userId ?? undefined,
      agentId: conversation.agentId,
      conversationId: conversation.id,
      message: `${body.message}${context.text}${mcpContext.text}`,
      requestId,
      providerCredentialId: body.providerCredentialId,
      model: body.model,
      inputKind: effectiveInputKind,
      media: combinedMedia,
    });
    return apiSuccess({ run: result.run, message: result.assistantMessage, mcpReferences: mcpContext.references }, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/chat");
  }
}
