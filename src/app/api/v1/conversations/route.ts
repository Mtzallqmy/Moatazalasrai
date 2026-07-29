import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agents, auditLogs, attachments, conversationFolders, conversations, messages } from "@/db/schema";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { uuidSchema } from "@/lib/http/contracts";
import { z } from "zod";

const createSchema = z.object({
  agentId: uuidSchema,
  title: z.string().trim().min(1).max(120).optional(),
}).strict();

const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rename"), conversationId: uuidSchema, title: z.string().trim().min(1).max(120) }).strict(),
  z.object({ action: z.literal("archive"), conversationId: uuidSchema }).strict(),
  z.object({ action: z.literal("restore"), conversationId: uuidSchema }).strict(),
  z.object({ action: z.literal("pin"), conversationId: uuidSchema, pinned: z.boolean() }).strict(),
  z.object({ action: z.literal("move"), conversationId: uuidSchema, folderId: uuidSchema.nullable() }).strict(),
]);

const deleteSchema = z.object({ conversationId: uuidSchema }).strict();

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    const conversationId = new URL(request.url).searchParams.get("conversationId");
    if (conversationId) {
      const id = uuidSchema.parse(conversationId);
      const [owned] = await db().select({ id: conversations.id }).from(conversations).where(and(
        eq(conversations.id, id),
        eq(conversations.organizationId, principal.organizationId),
      )).limit(1);
      if (!owned) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
      const rows = await db().select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        metadata: messages.metadata,
        createdAt: messages.createdAt,
        model: messages.model,
        editedAt: messages.editedAt,
      }).from(messages).where(and(eq(messages.conversationId, id), isNull(messages.deletedAt)))
        .orderBy(desc(messages.createdAt)).limit(100);
      const messageIds = rows.map((row) => row.id);
      const files = messageIds.length ? await db().select({
        id: attachments.id,
        messageId: attachments.messageId,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        sizeBytes: attachments.sizeBytes,
        processingStatus: attachments.processingStatus,
      }).from(attachments).where(and(
        eq(attachments.organizationId, principal.organizationId),
        inArray(attachments.messageId, messageIds),
        isNull(attachments.deletedAt),
      )) : [];
      return apiSuccess({
        messages: rows.reverse().map((row) => ({
          ...row,
          attachments: files.filter((file) => file.messageId === row.id),
        })),
      }, requestId);
    }
    const rows = await db().select({
      id: conversations.id,
      agentId: conversations.agentId,
      title: conversations.title,
      archivedAt: conversations.archivedAt,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    }).from(conversations).where(eq(conversations.organizationId, principal.organizationId))
      .orderBy(desc(conversations.updatedAt)).limit(100);
    return apiSuccess({ conversations: rows }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/conversations");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    const body = await parseJson(request, createSchema);
    const [agent] = await db().select({ id: agents.id, name: agents.name }).from(agents).where(and(
      eq(agents.id, body.agentId),
      eq(agents.organizationId, principal.organizationId),
      eq(agents.status, "published"),
    )).limit(1);
    if (!agent) throw new ApiError(422, "AGENT_UNAVAILABLE", "الوكيل غير منشور أو غير موجود.");
    const [created] = await db().insert(conversations).values({
      organizationId: principal.organizationId,
      agentId: agent.id,
      title: body.title ?? `محادثة مع ${agent.name}`,
    }).returning();
    return apiSuccess({ conversation: created }, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/conversations");
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    const body = await parseJson(request, mutationSchema, 16 * 1024);
    const updated = await db().transaction(async (tx) => {
      if (body.action === "move" && body.folderId) {
        const [folder] = await tx.select({ id: conversationFolders.id }).from(conversationFolders).where(and(
          eq(conversationFolders.id, body.folderId),
          eq(conversationFolders.organizationId, principal.organizationId),
          isNull(conversationFolders.deletedAt),
        )).limit(1);
        if (!folder) throw new ApiError(404, "FOLDER_NOT_FOUND", "القسم غير موجود.");
      }
      const changes = body.action === "rename" ? { title: body.title, updatedAt: new Date() }
        : body.action === "archive" ? { archivedAt: new Date(), updatedAt: new Date() }
        : body.action === "restore" ? { archivedAt: null, deletedAt: null, updatedAt: new Date() }
        : body.action === "pin" ? { pinnedAt: body.pinned ? new Date() : null, updatedAt: new Date() }
        : { folderId: body.folderId, updatedAt: new Date() };
      const [conversation] = await tx.update(conversations).set(changes).where(and(
        eq(conversations.id, body.conversationId),
        eq(conversations.organizationId, principal.organizationId),
      )).returning();
      if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
      await tx.insert(auditLogs).values({
        organizationId: principal.organizationId,
        actorType: "api_key",
        actorId: principal.apiKeyId,
        action: `conversation.${body.action}`,
        resourceType: "conversation",
        resourceId: conversation.id,
        metadata: { requestId },
      });
      return conversation;
    });
    return apiSuccess({ conversation: updated }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/conversations");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    const body = await parseJson(request, deleteSchema, 8 * 1024);
    const deleted = await db().transaction(async (tx) => {
      const [conversation] = await tx.update(conversations).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(
        eq(conversations.id, body.conversationId),
        eq(conversations.organizationId, principal.organizationId),
        isNull(conversations.deletedAt),
      )).returning({ id: conversations.id });
      if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
      await tx.insert(auditLogs).values({
        organizationId: principal.organizationId,
        actorType: "api_key",
        actorId: principal.apiKeyId,
        action: "conversation.delete",
        resourceType: "conversation",
        resourceId: conversation.id,
        metadata: { requestId },
      });
      return conversation;
    });
    return apiSuccess({ deleted: true, id: deleted.id }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/conversations");
  }
}
