import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agents, attachments, conversationMembers, conversations, messages, runs } from "@/db/schema";
import { executeAgentRun } from "@/lib/agents/runtime";
import { getAccessibleAgent } from "@/lib/agents/service";
import { assertActorPermission, type PlatformActor } from "@/lib/auth/actor-authorization";
import { conversationAccessFilter } from "@/lib/chat/access";
import { ApiError } from "@/lib/http/api";
import { attachmentContext } from "@/lib/storage/attachments";
import { inputKindForAttachments } from "@/server/files/input-kind";

export async function createConversation(input: {
  actor: PlatformActor;
  agentId: string;
}) {
  await assertActorPermission(input.actor, "agents:run");
  const agent = await getAccessibleAgent(input.actor, input.agentId);
  if (agent.status !== "published") {
    throw new ApiError(422, "AGENT_DRAFT", "الوكيل ما زال مسودة ولا يمكن تشغيله.");
  }
  if (!agent.ready) {
    if (!agent.providerCredentialId || !agent.providerEnabled || agent.providerValidationStatus !== "verified") {
      throw new ApiError(422, "PROVIDER_UNAVAILABLE", "مزود الوكيل غير متصل أو غير صالح.");
    }
    throw new ApiError(422, "MODEL_UNAVAILABLE", "نموذج الوكيل غير متاح لدى المزود الحالي.");
  }
  return db().transaction(async (tx) => {
    const [created] = await tx.insert(conversations).values({
      organizationId: input.actor.organizationId,
      agentId: agent.id,
      createdByUserId: input.actor.userId,
      providerCredentialId: agent.providerCredentialId,
      model: agent.model,
      title: null,
      status: "active",
    }).returning();
    if (!created) throw new Error("CONVERSATION_CREATE_FAILED");
    await tx.insert(conversationMembers).values({
      organizationId: input.actor.organizationId,
      conversationId: created.id,
      userId: input.actor.userId,
      role: "manager",
      addedByUserId: input.actor.userId,
    });
    return created;
  });
}

export async function getWritableConversation(input: {
  actor: PlatformActor;
  conversationId: string;
  expectedAgentId?: string;
}) {
  await assertActorPermission(input.actor, "agents:run");
  const [row] = await db().select({
    id: conversations.id,
    agentId: conversations.agentId,
    title: conversations.title,
    status: conversations.status,
    providerCredentialId: conversations.providerCredentialId,
    model: conversations.model,
    agentName: agents.name,
    agentStatus: agents.status,
  }).from(conversations)
    .innerJoin(agents, and(
      eq(agents.id, conversations.agentId),
      eq(agents.organizationId, input.actor.organizationId),
    ))
    .where(and(
      eq(conversations.id, input.conversationId),
      eq(conversations.organizationId, input.actor.organizationId),
      input.expectedAgentId ? eq(conversations.agentId, input.expectedAgentId) : undefined,
      conversationAccessFilter({
        role: input.actor.role,
        userId: input.actor.userId,
        access: "write",
      }),
      isNull(conversations.archivedAt),
      isNull(conversations.deletedAt),
    )).limit(1);
  if (!row) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة أو لا تملك حق الكتابة فيها.");
  if (row.agentStatus !== "published") throw new ApiError(422, "AGENT_DRAFT", "وكيل المحادثة غير منشور.");
  return row;
}

async function existingRunResult(organizationId: string, requestId: string) {
  const [run] = await db().select().from(runs).where(and(
    eq(runs.organizationId, organizationId),
    eq(runs.requestId, requestId),
  )).limit(1);
  if (!run) throw new ApiError(409, "DUPLICATE_MESSAGE", "تم استقبال الرسالة سابقًا ولم تكتمل نتيجتها بعد.");
  return { run, assistantMessage: null, duplicate: true as const };
}

export async function sendConversationMessage(input: {
  actor: PlatformActor;
  conversationId: string;
  text: string;
  requestId: string;
  clientRequestId: string;
  attachmentIds?: string[];
}) {
  await assertActorPermission(input.actor, "agents:run");
  const text = input.text.trim();
  const attachmentIds = input.attachmentIds ?? [];
  if (!text && attachmentIds.length === 0) {
    throw new ApiError(400, "EMPTY_MESSAGE", "لا يمكن إرسال رسالة فارغة.");
  }
  const conversation = await getWritableConversation({ actor: input.actor, conversationId: input.conversationId });
  const attachmentData = await attachmentContext(input.actor.organizationId, conversation.id, attachmentIds);
  const imageRows = attachmentData.rows.filter((file) => ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimeType));
  const media = imageRows.map((file) => ({
    type: "image" as const,
    mediaType: file.mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
    data: Buffer.from(file.content).toString("base64"),
  }));
  const inputKind = media.length > 0
    ? "image" as const
    : attachmentData.rows.length > 0
      ? inputKindForAttachments(attachmentData.rows.map((file) => file.mimeType))
      : "text" as const;
  const createdAt = new Date();
  const [userMessage] = await db().transaction(async (tx) => {
    const [created] = await tx.insert(messages).values({
      conversationId: conversation.id,
      role: "user",
      authorUserId: input.actor.userId,
      content: text || attachmentData.rows.map((file) => file.filename).filter(Boolean).join("، "),
      contentParts: text ? [{ type: "text", text }] : [],
      status: "completed",
      requestId: input.requestId,
      completedAt: createdAt,
      clientRequestId: input.clientRequestId,
      metadata: {
        source: "telegram",
        attachmentIds,
        attachments: attachmentData.rows.map((file) => ({
          id: file.id,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          processingStatus: file.processingStatus,
        })),
      },
    }).onConflictDoNothing().returning();
    if (!created) return [];
    if (attachmentIds.length > 0) {
      await tx.update(attachments).set({ messageId: created.id }).where(and(
        eq(attachments.organizationId, input.actor.organizationId),
        inArray(attachments.id, attachmentIds),
      ));
    }
    await tx.update(conversations).set({
      lastMessageAt: createdAt,
      updatedAt: createdAt,
    }).where(and(
      eq(conversations.id, conversation.id),
      eq(conversations.organizationId, input.actor.organizationId),
    ));
    return [created];
  });
  if (!userMessage) return existingRunResult(input.actor.organizationId, input.requestId);

  const prompt = `${text}${attachmentData.text}`.trim();
  if (!prompt && media.length === 0) {
    throw new ApiError(422, "FILE_CONTENT_UNAVAILABLE", "تم تخزين الملف لكن لا يوجد محتوى قابل للإرسال إلى الوكيل.");
  }
  return executeAgentRun({
    organizationId: input.actor.organizationId,
    userId: input.actor.userId,
    conversationAuthorized: true,
    agentId: conversation.agentId,
    conversationId: conversation.id,
    message: prompt || "حلل المرفق المرسل.",
    requestId: input.requestId,
    providerCredentialId: conversation.providerCredentialId ?? undefined,
    model: conversation.model ?? undefined,
    inputKind,
    media,
  });
}
