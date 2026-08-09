"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Row = Record<string, unknown> & { id: string };
type Data = {
  modules: Row[];
  features: Row[];
  roles: Row[];
  assignments: Row[];
  members: Row[];
  templates: Row[];
  rules: Row[];
};

const empty: Data = { modules: [], features: [], roles: [], assignments: [], members: [], templates: [], rules: [] };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function unwrap(value: unknown): Data {
  const root = record(value);
  return (root.data && typeof root.data === "object" ? root.data : root) as Data;
}

async function loadData(signal?: AbortSignal) {
  const response = await fetch("/api/dashboard/control-plane", { cache: "no-store", signal });
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error?.message || "تعذر تحميل أدوات المالك المتقدمة.");
  return unwrap(json);
}

export function PlatformAdvancedControls({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<Data>(empty);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setData(await loadData()), []);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal).then((next) => { if (!controller.signal.aborted) setData(next); }).catch((error: Error) => { if (!controller.signal.aborted) setNotice(error.message); });
    return () => controller.abort();
  }, []);

  async function mutate(operation: Record<string, unknown>, success: string) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/dashboard/control-plane", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(operation),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message || "فشلت العملية.");
      setNotice(success);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "فشلت العملية.");
    } finally {
      setBusy(false);
    }
  }

  const memberNames = useMemo(() => new Map(data.members.map((member) => [member.id, text(member.name) || text(member.email)])), [data.members]);
  const roleNames = useMemo(() => new Map(data.roles.map((role) => [role.id, text(role.name)])), [data.roles]);

  if (!canManage) return null;

  return <section className="mt-8 space-y-5">
    <div className="panel-header"><div><h2>إنشاء وربط متقدم</h2><p>إنشاء وحدات وميزات وقواعد إشعارات وإدارة إسنادات الأدوار من دون تعديل الكود.</p></div></div>

    <div className="grid gap-5 xl:grid-cols-2">
      <form action={async (form) => mutate({
        operation: "module.create",
        key: form.get("key"),
        name: form.get("name"),
        description: form.get("description") || undefined,
        status: form.get("status"),
        position: Number(form.get("position")),
        config: {},
      }, "تم إنشاء الوحدة.")} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
        <h3 className="font-semibold">وحدة جديدة</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><input name="key" required placeholder="reviews" dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="name" required placeholder="المراجعات" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="description" placeholder="وصف الوحدة" className="rounded-lg border px-3 py-2 dark:bg-slate-900 sm:col-span-2" /><select name="status" className="rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="active">مفعلة</option><option value="disabled">معطلة</option><option value="hidden">مخفية</option></select><input name="position" type="number" min="0" defaultValue="100" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /></div>
        <button disabled={busy} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white">إنشاء الوحدة</button>
      </form>

      <form action={async (form) => mutate({
        operation: "feature.upsert",
        key: form.get("key"),
        name: form.get("name"),
        description: form.get("description") || undefined,
        enabled: form.get("enabled") === "on",
        rolloutPercentage: Number(form.get("rolloutPercentage")),
        config: {},
      }, "تم إنشاء الميزة.")} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
        <h3 className="font-semibold">Feature Flag جديدة</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><input name="key" required placeholder="reviews" dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="name" required placeholder="نظام المراجعات" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="description" placeholder="وصف الميزة" className="rounded-lg border px-3 py-2 dark:bg-slate-900 sm:col-span-2" /><input name="rolloutPercentage" type="number" min="0" max="100" defaultValue="100" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><label className="flex items-center gap-2 rounded-lg border px-3 py-2"><input name="enabled" type="checkbox" /> تشغيل فوري</label></div>
        <button disabled={busy} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white">إنشاء الميزة</button>
      </form>
    </div>

    <div className="grid gap-5 xl:grid-cols-2">
      <form action={async (form) => mutate({
        operation: "rule.upsert",
        name: form.get("name"),
        eventKey: form.get("eventKey"),
        channel: form.get("channel"),
        templateId: form.get("templateId"),
        audienceType: form.get("audienceType"),
        audienceConfig: {},
        priority: Number(form.get("priority")),
        enabled: true,
      }, "تم إنشاء قاعدة الإشعار.")} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
        <h3 className="font-semibold">قاعدة إشعار جديدة</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><input name="name" required placeholder="إبلاغ المالك بحدث جديد" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="eventKey" required placeholder="order.created" dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><select name="templateId" required className="rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="">اختر القالب</option>{data.templates.map((template) => <option key={template.id} value={template.id}>{text(template.name)}</option>)}</select><select name="channel" className="rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="internal">داخلي</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="push">Push</option></select><select name="audienceType" className="rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="owners">المالك والمديرون</option><option value="event_user">مستخدم الحدث</option><option value="explicit">قائمة صريحة</option></select><input name="priority" type="number" min="0" defaultValue="100" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /></div>
        <button disabled={busy || !data.templates.length} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white">إنشاء القاعدة</button>
      </form>

      <div className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
        <h3 className="font-semibold">إسنادات الأدوار المخصصة</h3>
        <div className="mt-4 space-y-2">{data.assignments.map((assignment) => <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900"><span>{memberNames.get(text(assignment.organizationMemberId)) ?? text(assignment.organizationMemberId)} · {roleNames.get(text(assignment.roleId)) ?? text(assignment.roleId)}</span><button type="button" disabled={busy} onClick={() => void mutate({ operation: "role.unassign", organizationMemberId: assignment.organizationMemberId, roleId: assignment.roleId }, "تم إلغاء إسناد الدور.")} className="text-red-700">إلغاء الإسناد</button></div>)}{!data.assignments.length ? <p className="text-sm text-slate-500">لا توجد إسنادات مخصصة.</p> : null}</div>
      </div>
    </div>

    <div className="grid gap-5 xl:grid-cols-2">
      <div className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><h3 className="font-semibold">قوالب الإشعارات</h3><div className="mt-4 space-y-2">{data.templates.map((template) => <div key={template.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900"><span>{text(template.name)} · {text(template.channel)}</span><button type="button" disabled={busy} onClick={() => void mutate({ operation: "template.delete", id: template.id }, "نُقل القالب إلى سلة المحذوفات.")} className="text-red-700">حذف ناعم</button></div>)}</div></div>
      <div className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><h3 className="font-semibold">قواعد الإشعارات</h3><div className="mt-4 space-y-2">{data.rules.map((rule) => <div key={rule.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900"><span>{text(rule.name)} · {text(rule.eventKey)}</span><button type="button" disabled={busy} onClick={() => void mutate({ operation: "rule.delete", id: rule.id }, "نُقلت القاعدة إلى سلة المحذوفات.")} className="text-red-700">حذف ناعم</button></div>)}</div></div>
    </div>

    {notice ? <p className="rounded-xl bg-slate-100 p-3 text-sm dark:bg-slate-900">{notice}</p> : null}
  </section>;
}
