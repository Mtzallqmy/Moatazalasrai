import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationDrafts } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { conversationDraftSchema, uuidSchema } from "@/lib/http/contracts";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { requireConversationAccess } from "@/lib/chat/access";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("agents:run");
    const conversationId = uuidSchema.parse(new URL(request.url).searchParams.get("conversationId"));
    await requireConversationAccess({ organizationId: session.organizationId, conversationId, userId: session.userId, role: session.role, access: "write" });
    const [draft] = await db().select({
      content: conversationDrafts.content,
      updatedAt: conversationDrafts.updatedAt,
    }).from(conversationDrafts).where(and(
      eq(conversationDrafts.organizationId, session.organizationId),
      eq(conversationDrafts.conversationId, conversationId),
      eq(conversationDrafts.userId, session.userId),
    )).limit(1);
    return apiSuccess(draft ?? { content: "", updatedAt: null }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/chat/draft");
  }
}

export async function PUT(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("agents:run");
    const body = await parseJson(request, conversationDraftSchema, 32 * 1024);
    await requireConversationAccess({ organizationId: session.organizationId, conversationId: body.conversationId, userId: session.userId, role: session.role, access: "write" });
    const [draft] = await db().insert(conversationDrafts).values({
      organizationId: session.organizationId,
      conversationId: body.conversationId,
      userId: session.userId,
      content: body.content,
    }).onConflictDoUpdate({
      target: [conversationDrafts.conversationId, conversationDrafts.userId],
      set: { content: body.content, updatedAt: new Date() },
    }).returning({ content: conversationDrafts.content, updatedAt: conversationDrafts.updatedAt });
    return apiSuccess(draft, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/chat/draft");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("agents:run");
    const conversationId = uuidSchema.parse(new URL(request.url).searchParams.get("conversationId"));
    await requireConversationAccess({ organizationId: session.organizationId, conversationId, userId: session.userId, role: session.role, access: "write" });
    await db().delete(conversationDrafts).where(and(
      eq(conversationDrafts.organizationId, session.organizationId),
      eq(conversationDrafts.conversationId, conversationId),
      eq(conversationDrafts.userId, session.userId),
    ));
    return apiSuccess({ deleted: true }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/chat/draft");
  }
}
