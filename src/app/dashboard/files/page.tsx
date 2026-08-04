import { and, desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { FileManager } from "@/components/file-manager";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { currentSession } from "@/lib/auth/session";

export default async function FilesPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  const rows = await db().select({
    id: attachments.id,
    conversationId: attachments.conversationId,
    filename: attachments.filename,
    mimeType: attachments.mimeType,
    sizeBytes: attachments.sizeBytes,
    source: attachments.source,
    detectedType: attachments.detectedType,
    processingStatus: attachments.processingStatus,
    processingErrorCode: attachments.processingErrorCode,
    archivedAt: attachments.archivedAt,
    createdAt: attachments.createdAt,
    updatedAt: attachments.updatedAt,
  }).from(attachments).where(and(
    eq(attachments.organizationId, session.organizationId),
    session.role === "member" ? eq(attachments.uploadedByUserId, session.userId) : undefined,
    isNull(attachments.archivedAt),
    isNull(attachments.deletedAt),
  )).orderBy(desc(attachments.createdAt)).limit(100);

  return (
    <DashboardShell
      session={session}
      activePath="/dashboard/files"
      title="الملفات"
      description="رفع وتخزين ومعاينة الملفات الحقيقية، مع تقدم فعلي وعزل المؤسسة وحالات المعالجة."
    >
      <FileManager
        canManage={can(session.role, "files:manage")}
        initialItems={rows.map((row) => ({
          ...row,
          archivedAt: row.archivedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }))}
      />
    </DashboardShell>
  );
}
