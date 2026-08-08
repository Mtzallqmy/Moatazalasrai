import { and, count, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, conversationMembers, conversations, messages, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { canManageConversation, canWriteConversation, conversationAccessFilter } from "@/lib/chat/access";
import { createConversationForAgent } from "@/lib/chat/conversation-service";
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
          conversationAccessFilter({ role: session.role, userId: session.userId, access: "read" }),
          isNull(conversations.deletedAt),
        ))
        .limit(1);
      if (!owned) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
      const rows = await db().select({
          id: messages.id,
          role: messages.role,
          authorUserId: messages.authorUserId,
          authorName: users.name,
          authorEmail: users.email,
          content: messages.content,
          contentParts: messages.contentParts,
          status: messages.status,
          requestId: messages.requestId,
          metadata: messages.metadata,
          createdAt: messages.createdAt,
          completedAt: messages.completedAt,
          model: messages.model,
          inputTokens: messages.inputTokens,
          outputTokens: messages.outputTokens,
          latencyMs: messages.latencyMs,
          errorCode: messages.errorCode,
          editedAt: messages.editedAt,
          attachments: sql<Array<{
            id: string;
            filename: string;
            mimeType: string;
            sizeBytes: number;
            processingStatus: string;
            processingErrorCode: string | null;
          }>>`COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', message_files.id,
              'filename', message_files.filename,
              'mimeType', message_files.mime_type,
              'sizeBytes', message_files.size_bytes,
              'processingStatus', message_files.processing_status,
              'processingErrorCode', message_files.processing_error_code
            ) ORDER BY message_files.created_at)
            FROM attachments AS message_files
            WHERE message_files.message_id = ${messages.id}
              AND message_files.organization_id = ${session.organizationId}
              AND message_files.deleted_at IS NULL
          ), '[]'::jsonb)`,
        }).from(messages)
          .leftJoin(users, eq(users.id, messages.authorUserId))
          .where(and(eq(messages.conversationId, id), isNull(messages.deletedAt)))
          .orderBy(desc(messages.createdAt))
          .limit(query.limit)
          .offset((query.page - 1) * query.limit);
      return apiSuccess(rows.reverse(), requestId, 200, {
        pagination: { ...query, hasMore: rows.length === query.limit },
      });
    }

    const archived = url.searchParams.get("archived") === "true";
    const deleted = url.searchParams.get("deleted") === "true";
    const search = url.searchParams.get("q")?.trim().slice(0, 120) ?? "";
    const pattern = search ? `%${search}%` : "";
    const searchFilter = search
      ? or(
          ilike(conversations.title, pattern),
          sql<boolean>`EXISTS (
            SELECT 1
            FROM messages AS searchable_messages
            WHERE searchable_messages.conversation_id = ${conversations.id}
              AND searchable_messages.deleted_at IS NULL
              AND searchable_messages.content ILIKE ${pattern}
          )`,
        )
      : undefined;
    const archiveFilter = deleted
      ? undefined
      : archived
        ? isNotNull(conversations.archivedAt)
        : isNull(conversations.archivedAt);
    const where = and(
      eq(conversations.organizationId, session.organizationId),
      conversationAccessFilter({ role: session.role, userId: session.userId, access: "read" }),
      archiveFilter,
      deleted ? isNotNull(conversations.deletedAt) : isNull(conversations.deletedAt),
      searchFilter,
    );
    const [rows, totals] = await Promise.all([
      db().select({
        id: conversations.id,
        title: conversations.title,
        agentId: conversations.agentId,
        createdByUserId: conversations.createdByUserId,
        memberRole: conversationMembers.role,
        agentName: agents.name,
        summary: conversations.summary,
        status: conversations.status,
        archivedAt: conversations.archivedAt,
        deletedAt: conversations.deletedAt,
        pinnedAt: conversations.pinnedAt,
        providerCredentialId: conversations.providerCredentialId,
        model: conversations.model,
        lastMessageAt: conversations.lastMessageAt,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      }).from(conversations)
        .innerJoin(agents, eq(agents.id, conversations.agentId))
        .leftJoin(conversationMembers, and(
          eq(conversationMembers.conversationId, conversations.id),
          eq(conversationMembers.userId, session.userId),
        ))
        .where(where)
        .orderBy(desc(conversations.pinnedAt), desc(conversations.lastMessageAt), desc(conversations.updatedAt), desc(conversations.id))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      db().select({ value: count() }).from(conversations).where(where),
    ]);
    const total = totals[0]?.value ?? 0;
    const accessibleRows = rows.map((row) => ({
      ...row,
      canWrite: canWriteConversation(session.role, row.createdByUserId, session.userId, row.memberRole),
      canManage: canManageConversation(session.role, row.createdByUserId, session.userId, row.memberRole),
    }));
    return apiSuccess(accessibleRows, requestId, 200, {
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
      const result = await createConversationForAgent({
        userId: session.userId,
        organizationId: session.organizationId,
      }, body.agentId);
      return apiSuccess(result.conversation, requestId, 201);
    }

    const ownedWhere = and(
      eq(conversations.id, body.conversationId),
      eq(conversations.organizationId, session.organizationId),
      conversationAccessFilter({ role: session.role, userId: session.userId, access: "manage" }),
    );
    if (body.action === "delete") {
      const [deleted] = await db().update(conversations).set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() })
        .where(ownedWhere).returning({ id: conversations.id });
      if (!deleted) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
      return apiSuccess({ deleted: true, id: deleted.id }, requestId);
    }
    if (body.action === "restore") {
      const [restored] = await db().update(conversations).set({ status: "active", deletedAt: null, archivedAt: null, updatedAt: new Date() })
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
        : { status: body.archived ? "archived" : "active", archivedAt: body.archived ? new Date() : null, updatedAt: new Date() },
    ).where(ownedWhere).returning();
    if (!updated) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
    return apiSuccess(updated, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/chat");
  }
}
