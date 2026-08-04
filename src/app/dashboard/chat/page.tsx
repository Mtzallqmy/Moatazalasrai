import { and, desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { ChatConsole } from "@/components/chat-console";
import { DashboardShell } from "@/components/dashboard-shell";
import { db } from "@/db";
import { agents, conversationMembers, conversations, knowledgeBases, userPreferences } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";
import { aiFeatureEnabled } from "@/ai/config";
import { defaultChatAppearance, normalizeChatAppearance } from "@/lib/chat/appearance";
import { canManageConversation, canWriteConversation, conversationAccessFilter } from "@/lib/chat/access";
import { isPuterEnabled } from "@/lib/puter/feature";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ conversationId?: string; agentId?: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  if (session.role === "viewer") redirect("/forbidden");
  const ragEnabled = aiFeatureEnabled("RAG");
  const memoryEnabled = aiFeatureEnabled("MEMORY");
  const [publishedAgents, rows, [storedAppearance], bases] = await Promise.all([
    db().select({ id: agents.id, name: agents.name }).from(agents).where(and(eq(agents.organizationId, session.organizationId), eq(agents.status, "published"))).orderBy(desc(agents.updatedAt)),
    db().select({
      id: conversations.id,
      title: conversations.title,
      agentId: conversations.agentId,
      createdByUserId: conversations.createdByUserId,
      memberRole: conversationMembers.role,
      agentName: agents.name,
      summary: conversations.summary,
      status: conversations.status,
      pinnedAt: conversations.pinnedAt,
      archivedAt: conversations.archivedAt,
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
      .where(and(
      eq(conversations.organizationId, session.organizationId),
      conversationAccessFilter({ role: session.role, userId: session.userId, access: "read" }),
      isNull(conversations.deletedAt),
      isNull(conversations.archivedAt),
    )).orderBy(desc(conversations.pinnedAt), desc(conversations.lastMessageAt), desc(conversations.updatedAt)).limit(100),
    db().select({
      theme: userPreferences.chatTheme,
      wallpaper: userPreferences.chatWallpaper,
    }).from(userPreferences).where(eq(userPreferences.userId, session.userId)).limit(1),
    ragEnabled
      ? db().select({ id: knowledgeBases.id, name: knowledgeBases.name }).from(knowledgeBases).where(eq(knowledgeBases.organizationId, session.organizationId)).orderBy(desc(knowledgeBases.updatedAt)).limit(100)
      : Promise.resolve([]),
  ]);
  const params = await searchParams;
  return <DashboardShell session={session} activePath="/dashboard/chat" title="الدردشة" description="محادثات محفوظة وتشغيل فعلي للنموذج عبر الوكيل المنشور."><ChatConsole agents={publishedAgents} initialConversations={rows.map((row) => ({
    ...row,
    canWrite: canWriteConversation(session.role, row.createdByUserId, session.userId, row.memberRole),
    canManage: canManageConversation(session.role, row.createdByUserId, session.userId, row.memberRole),
    pinnedAt: row.pinnedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }))} initialConversationId={params.conversationId} initialAgentId={params.agentId} currentUser={{ id: session.userId, name: session.name ?? session.email, email: session.email }} initialAppearance={normalizeChatAppearance(storedAppearance ?? defaultChatAppearance)} puterEnabled={isPuterEnabled()} knowledgeBases={bases} ragEnabled={ragEnabled} memoryEnabled={memoryEnabled} /></DashboardShell>;
}
