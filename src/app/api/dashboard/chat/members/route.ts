import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, conversationMembers, organizationMembers, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { requireConversationAccess } from "@/lib/chat/access";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { uuidSchema } from "@/lib/http/contracts";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const upsertSchema = z.object({
  conversationId: uuidSchema,
  userId: uuidSchema,
  role: z.enum(["reader", "writer", "manager"]),
}).strict();
const removeSchema = z.object({ conversationId: uuidSchema, userId: uuidSchema }).strict();

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("agents:run");
    const conversationId = uuidSchema.parse(new URL(request.url).searchParams.get("conversationId"));
    const conversation = await requireConversationAccess({
      organizationId: session.organizationId,
      conversationId,
      userId: session.userId,
      role: session.role,
      access: "read",
      includeArchived: true,
    });
    const rows = await db().select({
      id: conversationMembers.id,
      userId: conversationMembers.userId,
      role: conversationMembers.role,
      name: users.name,
      email: users.email,
      organizationRole: organizationMembers.role,
      createdAt: conversationMembers.createdAt,
    }).from(conversationMembers)
      .innerJoin(users, eq(users.id, conversationMembers.userId))
      .innerJoin(organizationMembers, and(
        eq(organizationMembers.organizationId, session.organizationId),
        eq(organizationMembers.userId, conversationMembers.userId),
      ))
      .where(and(
        eq(conversationMembers.organizationId, session.organizationId),
        eq(conversationMembers.conversationId, conversationId),
      ))
      .orderBy(asc(users.name), asc(users.email));
    const current = rows.find((row) => row.userId === session.userId);
    const canManage = session.role !== "member" || conversation.createdByUserId === session.userId || current?.role === "manager";
    const availableMembers = canManage ? await db().select({
      userId: organizationMembers.userId,
      name: users.name,
      email: users.email,
      organizationRole: organizationMembers.role,
    }).from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, session.organizationId))
      .orderBy(asc(users.name), asc(users.email)) : [];
    return apiSuccess({
      conversation: { id: conversation.id, createdByUserId: conversation.createdByUserId },
      canManage,
      members: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      availableMembers,
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/chat/members");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("agents:run");
    await enforceRateLimit({ scope: "conversation.members.manage", key: `${session.organizationId}:${session.userId}`, limit: 30, windowMs: 60_000 });
    const body = await parseJson(request, upsertSchema, 8 * 1024);
    const conversation = await requireConversationAccess({
      organizationId: session.organizationId,
      conversationId: body.conversationId,
      userId: session.userId,
      role: session.role,
      access: "manage",
      includeArchived: true,
    });
    const [organizationMember] = await db().select({ id: organizationMembers.id }).from(organizationMembers).where(and(
      eq(organizationMembers.organizationId, session.organizationId),
      eq(organizationMembers.userId, body.userId),
    )).limit(1);
    if (!organizationMember) throw new ApiError(422, "MEMBER_NOT_IN_ORGANIZATION", "المستخدم ليس عضوًا في مساحة العمل الحالية.");
    if (conversation.createdByUserId === body.userId && body.role !== "manager") {
      throw new ApiError(409, "CONVERSATION_OWNER_ROLE_REQUIRED", "يجب أن يبقى منشئ المحادثة مديرًا.");
    }
    const [member] = await db().transaction(async (tx) => {
      const [saved] = await tx.insert(conversationMembers).values({
        organizationId: session.organizationId,
        conversationId: body.conversationId,
        userId: body.userId,
        role: body.role,
        addedByUserId: session.userId,
      }).onConflictDoUpdate({
        target: [conversationMembers.conversationId, conversationMembers.userId],
        set: { role: body.role, addedByUserId: session.userId, updatedAt: new Date() },
      }).returning();
      if (!saved) throw new Error("CONVERSATION_MEMBER_SAVE_FAILED");
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "conversation.member.upserted",
        resourceType: "conversation",
        resourceId: body.conversationId,
        metadata: { targetUserId: body.userId, role: body.role, requestId },
      });
      return [saved];
    });
    return apiSuccess(member, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/chat/members");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("agents:run");
    const body = await parseJson(request, removeSchema, 8 * 1024);
    const conversation = await requireConversationAccess({
      organizationId: session.organizationId,
      conversationId: body.conversationId,
      userId: session.userId,
      role: session.role,
      access: "manage",
      includeArchived: true,
    });
    if (conversation.createdByUserId === body.userId) {
      throw new ApiError(409, "CONVERSATION_OWNER_REMOVE_FORBIDDEN", "لا يمكن إزالة منشئ المحادثة.");
    }
    const [deleted] = await db().transaction(async (tx) => {
      const [row] = await tx.delete(conversationMembers).where(and(
        eq(conversationMembers.organizationId, session.organizationId),
        eq(conversationMembers.conversationId, body.conversationId),
        eq(conversationMembers.userId, body.userId),
      )).returning({ id: conversationMembers.id });
      if (!row) throw new ApiError(404, "CONVERSATION_MEMBER_NOT_FOUND", "عضو المحادثة غير موجود.");
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "conversation.member.removed",
        resourceType: "conversation",
        resourceId: body.conversationId,
        metadata: { targetUserId: body.userId, requestId },
      });
      return [row];
    });
    return apiSuccess({ deleted: true, id: deleted.id }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/chat/members");
  }
}
