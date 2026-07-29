import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { db } from "@/db";
import { attachments } from "@/db/schema";
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
    createdAt: attachments.createdAt,
  }).from(attachments).where(and(
    eq(attachments.organizationId, session.organizationId),
    session.role === "member" ? eq(attachments.uploadedByUserId, session.userId) : undefined,
  ))
    .orderBy(desc(attachments.createdAt)).limit(100);
  return (
    <DashboardShell session={session} activePath="/dashboard/files" title="الملفات" description="ملفات المؤسسة المحفوظة فعليًا مع عزل الصلاحيات وإمكانية العودة إلى المحادثة.">
      <section className="soft-card overflow-hidden">
        <div className="border-b p-5" style={{ borderColor: "var(--border)" }}>
          <h2 className="font-bold">أحدث الملفات</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>يتم الرفع من داخل الدردشة أو API، والحد الحالي 10MB.</p>
        </div>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="text-right" style={{ color: "var(--text-secondary)" }}><th className="p-4">الملف</th><th>النوع</th><th>الحجم</th><th>المصدر</th><th>الإجراء</th></tr></thead>
              <tbody>
                {rows.map((file) => (
                  <tr key={file.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="p-4 font-semibold">{file.filename}</td>
                    <td>{file.mimeType}</td>
                    <td>{Math.ceil(file.sizeBytes / 1024)}KB</td>
                    <td>{file.source}</td>
                    <td className="space-x-2 space-x-reverse">
                      <a className="text-sm underline" href={`/api/dashboard/files?id=${file.id}`}>تنزيل</a>
                      {file.conversationId ? <Link className="text-sm underline" href={`/dashboard/chat?conversationId=${file.conversationId}`}>المحادثة</Link> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="p-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>لا توجد ملفات بعد. ارفع أول ملف من الدردشة.</p>}
      </section>
    </DashboardShell>
  );
}
