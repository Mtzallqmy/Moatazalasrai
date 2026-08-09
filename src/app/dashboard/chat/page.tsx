import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { ChatConsoleV2 } from "@/components/chat-console-v2";
import { DashboardShell } from "@/components/dashboard-shell";
import { db } from "@/db";
import { agents, conversationMembers, conversations, userPreferences } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";
import { aiFeatureEnabled } from "@/ai/config";
import { defaultChatAppearance, normalizeChatAppearance } from "@/lib/chat/appearance";
import { canManageConversation, canWriteConversation, conversationAccessFilter } from "@/lib/chat/access";
import { isPuterEnabled } from "@/lib/puter/feature";
import "./conversation-workspace.css";

const conversationSelection = {
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
};

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ conversationId?: string; agentId?: string; view?: string; new?: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  if (session.role === "viewer") redirect("/forbidden");
  const role = session.role;
  const params = await searchParams;
  const archivedMode = params.view === "archived";
  const ragEnabled = aiFeatureEnabled("RAG");
  const memoryEnabled = aiFeatureEnabled("MEMORY");
  const [publishedAgents, rows, requestedRows, [storedAppearance]] = await Promise.all([
    db().select({ id: agents.id, name: agents.name }).from(agents).where(and(eq(agents.organizationId, session.organizationId), eq(agents.status, "published"))).orderBy(desc(agents.updatedAt)),
    db().select(conversationSelection).from(conversations)
      .innerJoin(agents, eq(agents.id, conversations.agentId))
      .leftJoin(conversationMembers, and(
        eq(conversationMembers.conversationId, conversations.id),
        eq(conversationMembers.userId, session.userId),
      ))
      .where(and(
        eq(conversations.organizationId, session.organizationId),
        conversationAccessFilter({ role: session.role, userId: session.userId, access: "read" }),
        isNull(conversations.deletedAt),
        archivedMode ? isNotNull(conversations.archivedAt) : isNull(conversations.archivedAt),
      ))
      .orderBy(desc(conversations.pinnedAt), desc(conversations.lastMessageAt), desc(conversations.updatedAt))
      .limit(50),
    params.conversationId ? db().select(conversationSelection).from(conversations)
      .innerJoin(agents, eq(agents.id, conversations.agentId))
      .leftJoin(conversationMembers, and(
        eq(conversationMembers.conversationId, conversations.id),
        eq(conversationMembers.userId, session.userId),
      ))
      .where(and(
        eq(conversations.id, params.conversationId),
        eq(conversations.organizationId, session.organizationId),
        conversationAccessFilter({ role: session.role, userId: session.userId, access: "read" }),
        isNull(conversations.deletedAt),
        archivedMode ? isNotNull(conversations.archivedAt) : isNull(conversations.archivedAt),
      ))
      .limit(1) : Promise.resolve([]),
    db().select({
      theme: userPreferences.chatTheme,
      wallpaper: userPreferences.chatWallpaper,
    }).from(userPreferences).where(eq(userPreferences.userId, session.userId)).limit(1),
  ]);
  const requestedConversation = requestedRows[0];
  const visibleRows = requestedConversation && !rows.some((row) => row.id === requestedConversation.id)
    ? [requestedConversation, ...rows]
    : rows;
  return (
    <DashboardShell
      session={session}
      activePath="/dashboard/chat"
      variant="chat"
      title="المحادثات"
      description="محادثات الوكلاء وملفاتها وسياقها في مساحة عمل بسيطة، مع التفاصيل المتقدمة عند الحاجة."
    >
      <div className="chat-workspace-shell">
        <ChatConsoleV2
          agents={publishedAgents}
          initialConversations={visibleRows.map((row) => ({
            ...row,
            canWrite: canWriteConversation(role, row.createdByUserId, session.userId, row.memberRole),
            canManage: canManageConversation(role, row.createdByUserId, session.userId, row.memberRole),
            pinnedAt: row.pinnedAt?.toISOString() ?? null,
            archivedAt: row.archivedAt?.toISOString() ?? null,
            lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          }))}
          initialConversationId={params.conversationId}
          initialAgentId={params.agentId}
          initialNewChat={params.new === "true"}
          currentUser={{ id: session.userId, name: session.name ?? session.email, email: session.email }}
          initialAppearance={normalizeChatAppearance(storedAppearance ?? defaultChatAppearance)}
          puterEnabled={isPuterEnabled()}
          ragEnabled={ragEnabled}
          memoryEnabled={memoryEnabled}
        />
      </div>
    </DashboardShell>
  );
}
