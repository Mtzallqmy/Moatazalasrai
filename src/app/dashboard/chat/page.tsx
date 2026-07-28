import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { ChatConsole } from "@/components/chat-console";
import { DashboardShell } from "@/components/dashboard-shell";
import { db } from "@/db";
import { agents, conversations } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";

export default async function ChatPage() {
  const session = await currentSession();
  if (!session?.organizationId) redirect("/login");
  const [publishedAgents, rows] = await Promise.all([
    db().select({ id: agents.id, name: agents.name }).from(agents).where(and(eq(agents.organizationId, session.organizationId), eq(agents.status, "published"))).orderBy(desc(agents.updatedAt)),
    db().select({ id: conversations.id, title: conversations.title, agentId: conversations.agentId, agentName: agents.name, updatedAt: conversations.updatedAt }).from(conversations).innerJoin(agents, eq(agents.id, conversations.agentId)).where(eq(conversations.organizationId, session.organizationId)).orderBy(desc(conversations.updatedAt)).limit(100),
  ]);
  return <DashboardShell session={session} activePath="/dashboard/chat" title="الدردشة" description="محادثات محفوظة وتشغيل فعلي للنموذج عبر الوكيل المنشور."><ChatConsole agents={publishedAgents} initialConversations={rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))} /></DashboardShell>;
}
