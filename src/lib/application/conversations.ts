import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  agentVersions,
  agents,
  conversationMembers,
  conversations,
} from "@/db/schema";
import type { Role } from "@/lib/auth/permissions";
import { conversationAccessFilter } from "@/lib/chat/access";
import { ApiError } from "@/lib/http/api";

export async function createConversation(input: {
  organizationId: string;
  actorUserId: string;
  agentId: string;
  title?: string | null;
}) {
  const [agent] = await db().select({
    id: agents.id,
    providerCredentialId: agentVersions.providerCredentialId,
    model: agentVersions.model,
  }).from(agents)
    .innerJoin(agentVersions, and(
      eq(agentVersions.agentId, agents.id),
      eq(agentVersions.version, agents.currentVersion),
    ))
    .where(and(
      eq(agents.id, input.agentId),
      eq(agents.organizationId, input.organizationId),
      eq(agents.status, "published"),
    )).limit(1);
  if (!agent) throw new ApiError(422, "AGENT_UNAVAILABLE", "الوكيل غير منشور أو غير موجود.");

  return db().transaction(async (tx) => {
    const [conversation] = await tx.insert(conversations).values({
      organizationId: input.organizationId,
      agentId: agent.id,
      createdByUserId: input.actorUserId,
      title: input.title?.trim() || null,
      status: "active",
      providerCredentialId: agent.providerCredentialId,
      model: agent.model,
      lastMessageAt: new Date(),
    }).returning();
    if (!conversation) throw new Error("CONVERSATION_CREATE_FAILED");
    await tx.insert(conversationMembers).values({
      organizationId: input.organizationId,
      conversationId: conversation.id,
      userId: input.actorUserId,
      role: "manager",
      addedByUserId: input.actorUserId,
    });
    return conversation;
  });
}

export async function listAccessibleConversations(input: {
  organizationId: string;
  userId: string;
  role: Role;
  limit?: number;
  offset?: number;
}) {
  return db().select({
    id: conversations.id,
    title: conversations.title,
    status: conversations.status,
    agentId: conversations.agentId,
    agentName: agents.name,
    model: conversations.model,
    lastMessageAt: conversations.lastMessageAt,
    updatedAt: conversations.updatedAt,
  }).from(conversations)
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .where(and(
      eq(conversations.organizationId, input.organizationId),
      conversationAccessFilter({ role: input.role, userId: input.userId, access: "read" }),
      isNull(conversations.archivedAt),
      isNull(conversations.deletedAt),
    ))
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.updatedAt))
    .limit(Math.min(Math.max(input.limit ?? 20, 1), 100))
    .offset(Math.max(input.offset ?? 0, 0));
}
