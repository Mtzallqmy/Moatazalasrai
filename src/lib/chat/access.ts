import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { conversationMembers, conversations } from "@/db/schema";
import type { Role } from "@/lib/auth/permissions";
import { ApiError } from "@/lib/http/api";

export type ConversationAccess = "read" | "write" | "manage";

function memberRoleFilter(access: ConversationAccess): SQL {
  if (access === "manage") return sql`${conversationMembers.role} = 'manager'::conversation_member_role`;
  if (access === "write") {
    return sql`${conversationMembers.role} in ('writer'::conversation_member_role, 'manager'::conversation_member_role)`;
  }
  return sql`${conversationMembers.role} in ('reader'::conversation_member_role, 'writer'::conversation_member_role, 'manager'::conversation_member_role)`;
}

export function conversationAccessFilter(input: {
  role: Role;
  userId: string;
  access: ConversationAccess;
}): SQL | undefined {
  if (input.role !== "member") return undefined;
  return or(
    eq(conversations.createdByUserId, input.userId),
    sql`exists (
      select 1 from ${conversationMembers}
      where ${conversationMembers.conversationId} = ${conversations.id}
        and ${conversationMembers.userId} = ${input.userId}
        and ${memberRoleFilter(input.access)}
    )`,
  );
}

export async function requireConversationAccess(input: {
  organizationId: string;
  conversationId: string;
  userId: string;
  role: Role;
  access: ConversationAccess;
  includeArchived?: boolean;
}) {
  const [conversation] = await db().select({
    id: conversations.id,
    agentId: conversations.agentId,
    createdByUserId: conversations.createdByUserId,
    status: conversations.status,
    archivedAt: conversations.archivedAt,
    deletedAt: conversations.deletedAt,
  }).from(conversations).where(and(
    eq(conversations.id, input.conversationId),
    eq(conversations.organizationId, input.organizationId),
    conversationAccessFilter(input),
    sql`${conversations.deletedAt} is null`,
    input.includeArchived ? undefined : sql`${conversations.archivedAt} is null`,
  )).limit(1);
  if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة أو لا تملك صلاحية الوصول إليها.");
  return conversation;
}

export function canWriteConversation(role: Role, createdByUserId: string | null, userId: string, memberRole?: string | null) {
  return role !== "member" || createdByUserId === userId || memberRole === "writer" || memberRole === "manager";
}

export function canManageConversation(role: Role, createdByUserId: string | null, userId: string, memberRole?: string | null) {
  return role !== "member" || createdByUserId === userId || memberRole === "manager";
}
