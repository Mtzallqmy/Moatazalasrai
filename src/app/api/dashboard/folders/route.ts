import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, conversationFolders, conversations } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { uuidSchema } from "@/lib/http/contracts";

const folderSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: z.string().trim().min(1).max(80) }).strict(),
  z.object({ action: z.literal("rename"), id: uuidSchema, name: z.string().trim().min(1).max(80) }).strict(),
  z.object({ action: z.literal("archive"), id: uuidSchema, archived: z.boolean() }).strict(),
  z.object({ action: z.literal("delete"), id: uuidSchema }).strict(),
  z.object({ action: z.literal("restore"), id: uuidSchema }).strict(),
]);

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("agents:run");
    const rows = await db().select().from(conversationFolders).where(and(
      eq(conversationFolders.organizationId, session.organizationId),
      isNull(conversationFolders.deletedAt),
    )).orderBy(desc(conversationFolders.updatedAt));
    return apiSuccess(rows, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/folders");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("agents:run");
    const body = await parseJson(request, folderSchema, 8 * 1024);
    const result = await db().transaction(async (tx) => {
      if (body.action === "create") {
        const [created] = await tx.insert(conversationFolders).values({
          organizationId: session.organizationId, createdByUserId: session.userId, name: body.name,
        }).returning();
        return created;
      }
      const [existing] = await tx.select({ id: conversationFolders.id }).from(conversationFolders).where(and(
        eq(conversationFolders.id, body.id),
        eq(conversationFolders.organizationId, session.organizationId),
      )).limit(1);
      if (!existing) throw new ApiError(404, "FOLDER_NOT_FOUND", "القسم غير موجود.");
      if (body.action === "delete") {
        await tx.update(conversations).set({ folderId: null, updatedAt: new Date() }).where(eq(conversations.folderId, body.id));
      }
      const changes = body.action === "rename" ? { name: body.name, updatedAt: new Date() }
        : body.action === "archive" ? { archivedAt: body.archived ? new Date() : null, updatedAt: new Date() }
          : { deletedAt: body.action === "delete" ? new Date() : null, updatedAt: new Date() };
      const [updated] = await tx.update(conversationFolders).set(changes).where(eq(conversationFolders.id, body.id)).returning();
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId, actorType: "user", actorId: session.userId,
        action: `folder.${body.action}`, resourceType: "conversation_folder", resourceId: body.id, metadata: { requestId },
      });
      return updated;
    });
    return apiSuccess(result, requestId, body.action === "create" ? 201 : 200);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/folders");
  }
}
