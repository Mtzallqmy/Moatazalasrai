import Link from "next/link";
import { ArrowRight, Braces, MessageSquare, TerminalSquare } from "lucide-react";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { DeveloperModeSetting } from "@/components/developer-mode-setting";
import { currentSession } from "@/lib/auth/session";
import { developerModeEnabled } from "@/lib/preferences/developer-mode";
import "./developer-mode.css";

export default async function DeveloperModeSettingsPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  const enabled = await developerModeEnabled(session.userId);

  return <DashboardShell
    session={session}
    activePath="/dashboard/settings"
    title="تفاصيل المطور"
    description="تحكم في مقدار التفاصيل التقنية المعروضة داخل تجربة العمل اليومية دون تغيير أي صلاحيات تشغيلية."
    actions={<Link href="/dashboard/settings" className="secondary-button"><ArrowRight size={15} /> الإعدادات</Link>}
  >
    <DeveloperModeSetting initialEnabled={enabled} />
    <section className="developer-mode-examples">
      <article><MessageSquare size={18} /><div><h3>المحادثات</h3><p>عند التفعيل تُفتح تفاصيل النموذج، المزوّد، زمن الاستجابة، Tokens وRun ID تلقائيًا. عند التعطيل تبقى خلف «التفاصيل التقنية».</p></div></article>
      <article><TerminalSquare size={18} /><div><h3>التشغيلات</h3><p>التفاصيل التشغيلية تبقى متاحة في صفحة التشغيل، مع إبقاء الملخص الأساسي بسيطًا للمستخدم العادي.</p></div></article>
      <article><Braces size={18} /><div><h3>الأدوات وMCP</h3><p>هذا الإعداد لا يمنح صلاحيات أدوات ولا يغير سياسات الموافقة؛ هو تفضيل عرض فقط.</p></div></article>
    </section>
  </DashboardShell>;
}
