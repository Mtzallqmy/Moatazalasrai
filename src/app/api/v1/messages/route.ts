import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, conversations, messages } from "@/db/schema";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { uuidSchema } from "@/lib/http/contracts";

const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), messageId: uuidSchema, content: z.string().trim().min(1).max(30_000) }).strict(),
  z.object({ action: z.literal("delete"), messageId: uuidSchema }).strict(),
  z.object({ action: z.literal("restore"), messageId: uuidSchema }).strict(),
]);

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    const body = await parseJson(request, mutationSchema, 40 * 1024);
    const result = await db().transaction(async (tx) => {
      const [owned] = await tx.select({ id: messages.id, role: messages.role })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(and(eq(messages.id, body.messageId), eq(conversations.organizationId, principal.organizationId)))
        .limit(1);
      if (!owned) throw new ApiError(404, "MESSAGE_NOT_FOUND", "الرسالة غير موجودة.");
      if (body.action === "edit" && owned.role !== "user") {
        throw new ApiError(409, "MESSAGE_NOT_EDITABLE", "يمكن تعديل رسائل المستخدم فقط.");
      }
      const changes = body.action === "edit"
        ? { content: body.content, editedAt: new Date() }
        : { deletedAt: body.action === "delete" ? new Date() : null };
      const [updated] = await tx.update(messages).set(changes).where(eq(messages.id, owned.id)).returning();
      await tx.insert(auditLogs).values({
        organizationId: principal.organizationId,
        actorType: "api_key",
        actorId: principal.apiKeyId,
        action: `message.${body.action}`,
        resourceType: "message",
        resourceId: owned.id,
        metadata: { requestId },
      });
      return updated;
    });
    return apiSuccess({ message: result }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/messages");
  }
}
