import { and, desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { ChatConsole } from "@/components/chat-console";
import { DashboardShell } from "@/components/dashboard-shell";
import { db } from "@/db";
import { agents, conversations } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ conversationId?: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  if (session.role === "viewer") redirect("/forbidden");
  const [publishedAgents, rows] = await Promise.all([
    db().select({ id: agents.id, name: agents.name }).from(agents).where(and(eq(agents.organizationId, session.organizationId), eq(agents.status, "published"))).orderBy(desc(agents.updatedAt)),
    db().select({ id: conversations.id, title: conversations.title, agentId: conversations.agentId, agentName: agents.name, updatedAt: conversations.updatedAt }).from(conversations).innerJoin(agents, eq(agents.id, conversations.agentId)).where(and(
      eq(conversations.organizationId, session.organizationId),
      session.role === "member" ? eq(conversations.createdByUserId, session.userId) : undefined,
      isNull(conversations.deletedAt),
      isNull(conversations.archivedAt),
    )).orderBy(desc(conversations.updatedAt)).limit(100),
  ]);
  const params = await searchParams;
  return <DashboardShell session={session} activePath="/dashboard/chat" title="الدردشة" description="محادثات محفوظة وتشغيل فعلي للنموذج عبر الوكيل المنشور."><ChatConsole agents={publishedAgents} initialConversations={rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))} initialConversationId={params.conversationId} /></DashboardShell>;
}
