import { and, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agents, attachments, conversations, messages } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { conversationActionSchema, paginationSchema, uuidSchema } from "@/lib/http/contracts";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("agents:run");
    const url = new URL(request.url);
    const query = paginationSchema.parse(Object.fromEntries(url.searchParams));
    const conversationId = url.searchParams.get("conversationId");
    if (conversationId) {
      const id = uuidSchema.parse(conversationId);
      const [owned] = await db().select({ id: conversations.id })
        .from(conversations)
        .where(and(
          eq(conversations.id, id),
          eq(conversations.organizationId, session.organizationId),
          session.role === "member" ? eq(conversations.createdByUserId, session.userId) : undefined,
        ))
        .limit(1);
      if (!owned) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
      const [rows, totals] = await Promise.all([
        db().select({
          id: messages.id,
          role: messages.role,
          content: messages.content,
          metadata: messages.metadata,
          createdAt: messages.createdAt,
          model: messages.model,
          editedAt: messages.editedAt,
        }).from(messages)
          .where(and(eq(messages.conversationId, id), isNull(messages.deletedAt)))
          .orderBy(desc(messages.createdAt))
          .limit(query.limit)
          .offset((query.page - 1) * query.limit),
        db().select({ value: count() }).from(messages).where(and(eq(messages.conversationId, id), isNull(messages.deletedAt))),
      ]);
      const total = totals[0]?.value ?? 0;
      const messageIds = rows.map((row) => row.id);
      const fileRows = messageIds.length ? await db().select({
        id: attachments.id, messageId: attachments.messageId, filename: attachments.filename,
        mimeType: attachments.mimeType, sizeBytes: attachments.sizeBytes,
        processingStatus: attachments.processingStatus, processingErrorCode: attachments.processingErrorCode,
      }).from(attachments).where(and(
        eq(attachments.organizationId, session.organizationId),
        inArray(attachments.messageId, messageIds),
        isNull(attachments.deletedAt),
      )) : [];
      const enriched = rows.reverse().map((row) => ({
        ...row,
        attachments: fileRows.filter((file) => file.messageId === row.id),
      }));
      return apiSuccess(enriched, requestId, 200, {
        pagination: { ...query, total, pages: Math.ceil(total / query.limit) },
      });
    }

    const archived = url.searchParams.get("archived") === "true";
    const where = and(
      eq(conversations.organizationId, session.organizationId),
      session.role === "member" ? eq(conversations.createdByUserId, session.userId) : undefined,
      archived ? isNotNull(conversations.archivedAt) : isNull(conversations.archivedAt),
      isNull(conversations.deletedAt),
    );
    const [rows, totals] = await Promise.all([
      db().select({
        id: conversations.id,
        title: conversations.title,
        agentId: conversations.agentId,
        agentName: agents.name,
        archivedAt: conversations.archivedAt,
        updatedAt: conversations.updatedAt,
      }).from(conversations)
        .innerJoin(agents, eq(agents.id, conversations.agentId))
        .where(where)
        .orderBy(desc(conversations.updatedAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      db().select({ value: count() }).from(conversations).where(where),
    ]);
    const total = totals[0]?.value ?? 0;
    return apiSuccess(rows, requestId, 200, {
      pagination: { ...query, total, pages: Math.ceil(total / query.limit) },
    });
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/chat");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("agents:run");
    const body = await parseJson(request, conversationActionSchema, 8 * 1024);
    if (body.action === "create") {
      const [agent] = await db().select({ id: agents.id, name: agents.name })
        .from(agents)
        .where(and(
          eq(agents.id, body.agentId),
          eq(agents.organizationId, session.organizationId),
          eq(agents.status, "published"),
        ))
        .limit(1);
      if (!agent) throw new ApiError(422, "AGENT_UNAVAILABLE", "الوكيل غير منشور أو غير موجود.");
      const [conversation] = await db().insert(conversations).values({
        organizationId: session.organizationId,
        agentId: agent.id,
        createdByUserId: session.userId,
        title: `محادثة مع ${agent.name}`,
      }).returning();
      return apiSuccess(conversation, requestId, 201);
    }

    const ownedWhere = and(
      eq(conversations.id, body.conversationId),
      eq(conversations.organizationId, session.organizationId),
      session.role === "member" ? eq(conversations.createdByUserId, session.userId) : undefined,
    );
    if (body.action === "delete") {
      const [deleted] = await db().update(conversations).set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(ownedWhere).returning({ id: conversations.id });
      if (!deleted) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
      return apiSuccess({ deleted: true, id: deleted.id }, requestId);
    }
    if (body.action === "restore") {
      const [restored] = await db().update(conversations).set({ deletedAt: null, archivedAt: null, updatedAt: new Date() })
        .where(ownedWhere).returning();
      if (!restored) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
      return apiSuccess(restored, requestId);
    }
    if (body.action === "pin") {
      const [pinned] = await db().update(conversations).set({ pinnedAt: body.pinned ? new Date() : null, updatedAt: new Date() })
        .where(ownedWhere).returning();
      if (!pinned) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
      return apiSuccess(pinned, requestId);
    }
    if (body.action === "move") {
      const [moved] = await db().update(conversations).set({ folderId: body.folderId, updatedAt: new Date() })
        .where(ownedWhere).returning();
      if (!moved) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
      return apiSuccess(moved, requestId);
    }
    const [updated] = await db().update(conversations).set(
      body.action === "rename"
        ? { title: body.title, updatedAt: new Date() }
        : { archivedAt: body.archived ? new Date() : null, updatedAt: new Date() },
    ).where(ownedWhere).returning();
    if (!updated) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
    return apiSuccess(updated, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/chat");
  }
}
