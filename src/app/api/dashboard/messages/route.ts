import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, conversationMembers, conversations, messages } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { conversationAccessFilter } from "@/lib/chat/access";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { uuidSchema } from "@/lib/http/contracts";

const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), messageId: uuidSchema, content: z.string().trim().min(1).max(30_000) }).strict(),
  z.object({ action: z.literal("delete"), messageId: uuidSchema }).strict(),
  z.object({ action: z.literal("restore"), messageId: uuidSchema }).strict(),
]);

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("agents:run");
    const body = await parseJson(request, mutationSchema, 40 * 1024);
    const result = await db().transaction(async (tx) => {
      const [owned] = await tx.select({
        id: messages.id,
        role: messages.role,
        authorUserId: messages.authorUserId,
        createdByUserId: conversations.createdByUserId,
        memberRole: conversationMembers.role,
      })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .leftJoin(conversationMembers, and(
          eq(conversationMembers.conversationId, conversations.id),
          eq(conversationMembers.userId, session.userId),
        ))
        .where(and(
          eq(messages.id, body.messageId),
          eq(conversations.organizationId, session.organizationId),
          conversationAccessFilter({ role: session.role, userId: session.userId, access: "write" }),
        ))
        .limit(1);
      if (!owned) throw new ApiError(404, "MESSAGE_NOT_FOUND", "الرسالة غير موجودة.");
      const canManage = session.role !== "member" || owned.createdByUserId === session.userId || owned.memberRole === "manager";
      if (!canManage && owned.authorUserId !== session.userId) {
        throw new ApiError(403, "MESSAGE_MUTATION_FORBIDDEN", "لا يمكنك تعديل أو حذف رسالة عضو آخر.");
      }
      if (body.action === "edit" && owned.role !== "user") {
        throw new ApiError(409, "MESSAGE_NOT_EDITABLE", "يمكن تعديل رسائل المستخدم فقط.");
      }
      const changes = body.action === "edit"
        ? { content: body.content, editedAt: new Date() }
        : { deletedAt: body.action === "delete" ? new Date() : null };
      const [updated] = await tx.update(messages).set(changes).where(eq(messages.id, owned.id)).returning();
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: `message.${body.action}`,
        resourceType: "message",
        resourceId: owned.id,
        metadata: { requestId },
      });
      return updated;
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/messages");
  }
}
