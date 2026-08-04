import { and, desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { aiFeatureEnabled } from "@/ai/config";
import { DashboardShell } from "@/components/dashboard-shell";
import { KnowledgeManager } from "@/components/knowledge-manager";
import { db } from "@/db";
import { attachments, knowledgeBases } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { currentSession } from "@/lib/auth/session";

export default async function KnowledgePage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  const enabled = aiFeatureEnabled("RAG");
  const [bases, files] = enabled ? await Promise.all([
    db().select().from(knowledgeBases)
      .where(eq(knowledgeBases.organizationId, session.organizationId))
      .orderBy(desc(knowledgeBases.updatedAt)),
    db().select({
      id: attachments.id,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
    }).from(attachments).where(and(
      eq(attachments.organizationId, session.organizationId),
      session.role === "member" ? eq(attachments.uploadedByUserId, session.userId) : undefined,
      eq(attachments.processingStatus, "ready"),
      isNull(attachments.archivedAt),
      isNull(attachments.deletedAt),
    )).orderBy(desc(attachments.createdAt)).limit(200),
  ]) : [[], []];

  return (
    <DashboardShell
      session={session}
      activePath="/dashboard/knowledge"
      title="قواعد المعرفة"
      description="إدارة مصادر RAG الفعلية ومتابعة ingestion من قاعدة البيانات والـworker دون حالات وهمية."
    >
      <KnowledgeManager
        enabled={enabled}
        canManage={can(session.role, "files:manage")}
        initialBases={bases.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() }))}
        readyFiles={files}
      />
    </DashboardShell>
  );
}
