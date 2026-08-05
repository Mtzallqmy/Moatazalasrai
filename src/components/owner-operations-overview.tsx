import { and, count, desc, eq, isNull } from "drizzle-orm";
import { AlertTriangle, BellRing, FileText, Layers3, Users, Wrench } from "lucide-react";
import { db } from "@/db";
import { sitePages, siteServices } from "@/db/admin-schema";
import { domainEvents, notificationDeliveries, platformModules } from "@/db/control-plane-schema";
import { auditLogs, organizationMembers } from "@/db/schema";

export async function OwnerOperationsOverview({ organizationId }: { organizationId: string }) {
  const [members, pages, services, modules, failedDeliveries, pendingEvents, recentActivity] = await Promise.all([
    db().select({ value: count() }).from(organizationMembers).where(eq(organizationMembers.organizationId, organizationId)),
    db().select({ value: count() }).from(sitePages).where(and(eq(sitePages.organizationId, organizationId), eq(sitePages.status, "published"), isNull(sitePages.deletedAt))),
    db().select({ value: count() }).from(siteServices).where(and(eq(siteServices.organizationId, organizationId), eq(siteServices.status, "active"), isNull(siteServices.deletedAt))),
    db().select({ value: count() }).from(platformModules).where(and(eq(platformModules.organizationId, organizationId), eq(platformModules.status, "active"), isNull(platformModules.deletedAt))),
    db().select({ value: count() }).from(notificationDeliveries).where(and(eq(notificationDeliveries.organizationId, organizationId), eq(notificationDeliveries.status, "failed"))),
    db().select({ value: count() }).from(domainEvents).where(and(eq(domainEvents.organizationId, organizationId), isNull(domainEvents.processedAt))),
    db().select({
      id: auditLogs.id,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      actorId: auditLogs.actorId,
      createdAt: auditLogs.createdAt,
    }).from(auditLogs).where(eq(auditLogs.organizationId, organizationId)).orderBy(desc(auditLogs.createdAt)).limit(8),
  ]);

  const metrics = [
    { label: "المستخدمون", value: members[0]?.value ?? 0, icon: Users },
    { label: "الصفحات المنشورة", value: pages[0]?.value ?? 0, icon: FileText },
    { label: "الخدمات النشطة", value: services[0]?.value ?? 0, icon: Wrench },
    { label: "الوحدات المفعلة", value: modules[0]?.value ?? 0, icon: Layers3 },
    { label: "إشعارات فاشلة", value: failedDeliveries[0]?.value ?? 0, icon: AlertTriangle },
    { label: "أحداث بانتظار المعالجة", value: pendingEvents[0]?.value ?? 0, icon: BellRing },
  ];

  return <section className="mt-7 space-y-5">
    <div className="panel-header"><div><h2>مؤشرات المالك التشغيلية</h2><p>حالة المحتوى والخدمات والإشعارات والأحداث داخل المؤسسة.</p></div></div>
    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{metrics.map((metric) => {
      const Icon = metric.icon;
      return <div key={metric.label} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><div className="flex items-center justify-between"><dt className="text-sm text-slate-500">{metric.label}</dt><Icon size={18} aria-hidden="true" /></div><dd className="mt-3 text-3xl font-bold">{metric.value}</dd></div>;
    })}</dl>
    <div className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><div className="panel-header"><div><h2>آخر النشاطات الإدارية</h2><p>مقتطف من سجل التدقيق الكامل.</p></div></div><div className="space-y-2">{recentActivity.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-900"><span><strong>{item.action}</strong> · {item.resourceType}{item.resourceId ? ` / ${item.resourceId.slice(0, 12)}` : ""}</span><span className="text-xs text-slate-500">{item.createdAt.toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" })}</span></div>)}{!recentActivity.length ? <p className="text-sm text-slate-500">لا توجد نشاطات مسجلة بعد.</p> : null}</div></div>
  </section>;
}
