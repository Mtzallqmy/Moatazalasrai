import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agents, conversations, messages } from "@/db/schema";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { uuidSchema } from "@/lib/http/contracts";
import { z } from "zod";

const createSchema = z.object({
  agentId: uuidSchema,
  title: z.string().trim().min(1).max(120).optional(),
}).strict();

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
      }).from(messages).where(eq(messages.conversationId, id)).orderBy(desc(messages.createdAt)).limit(100);
      return apiSuccess({ messages: rows.reverse() }, requestId);
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
