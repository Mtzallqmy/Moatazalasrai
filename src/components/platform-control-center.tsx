"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ALL_PERMISSIONS } from "@/lib/auth/permissions";

type Row = Record<string, unknown> & { id: string };
type Data = {
  modules: Row[];
  features: Row[];
  settings: Row[];
  roles: Row[];
  rolePermissions: Row[];
  assignments: Row[];
  members: Row[];
  templates: Row[];
  rules: Row[];
  trash: Row[];
  deliveries: Row[];
};
type Tab = "modules" | "features" | "roles" | "notifications" | "settings" | "trash";

const emptyData: Data = {
  modules: [], features: [], settings: [], roles: [], rolePermissions: [], assignments: [], members: [],
  templates: [], rules: [], trash: [], deliveries: [],
};

function unwrap(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return record.data && typeof record.data === "object" ? record.data as Data : record as unknown as Data;
}

async function fetchControlPlane(signal?: AbortSignal) {
  const response = await fetch("/api/dashboard/control-plane", { cache: "no-store", signal });
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error?.message || "تعذر تحميل مركز التحكم.");
  return unwrap(json);
}

function text(value: unknown) {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

export function PlatformControlCenter({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<Data>(emptyData);
  const [tab, setTab] = useState<Tab>("modules");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => setData(await fetchControlPlane()), []);
  useEffect(() => {
    const controller = new AbortController();
    void fetchControlPlane(controller.signal).then((next) => {
      if (!controller.signal.aborted) setData(next);
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setNotice(error.message);
    });
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

  const permissionsByRole = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of data.rolePermissions) {
      const roleId = text(row.roleId);
      const current = map.get(roleId) ?? [];
      current.push(text(row.permission));
      map.set(roleId, current);
    }
    return map;
  }, [data.rolePermissions]);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "modules", label: "الوحدات" },
    { id: "features", label: "الميزات" },
    { id: "roles", label: "الأدوار" },
    { id: "notifications", label: "الإشعارات" },
    { id: "settings", label: "الإعدادات" },
    { id: "trash", label: "سلة المحذوفات" },
  ];

  return <div className="space-y-5">
    <div className="flex flex-wrap gap-2 rounded-2xl border bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
      {tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`rounded-xl px-4 py-2 text-sm ${tab === item.id ? "bg-blue-600 text-white" : "bg-slate-100 dark:bg-slate-900"}`}>{item.label}</button>)}
    </div>

    {tab === "modules" ? <section className="grid gap-4 lg:grid-cols-2">
      {data.modules.map((module) => <form key={module.id} action={async (form) => mutate({
        operation: "module.update",
        id: module.id,
        name: form.get("name"),
        status: form.get("status"),
        position: Number(form.get("position")),
      }, "تم تحديث الوحدة.")} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-3 flex items-center justify-between"><strong>{text(module.name)}</strong><code className="text-xs">{text(module.key)}</code></div>
        <p className="mb-4 text-sm text-slate-500">{text(module.description)}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <input name="name" defaultValue={text(module.name)} className="rounded-lg border px-3 py-2 dark:bg-slate-900" />
          <select name="status" defaultValue={text(module.status)} className="rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="active">مفعّل</option><option value="disabled">معطّل</option><option value="hidden">مخفي</option><option value="deleted">محذوف</option></select>
          <input name="position" type="number" min="0" defaultValue={Number(module.position ?? 100)} className="rounded-lg border px-3 py-2 dark:bg-slate-900" />
        </div>
        {canManage ? <button disabled={busy} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white">حفظ</button> : null}
      </form>)}
    </section> : null}

    {tab === "features" ? <section className="grid gap-4 lg:grid-cols-2">
      {data.features.map((feature) => <form key={feature.id} action={async (form) => mutate({
        operation: "feature.update",
        id: feature.id,
        enabled: form.get("enabled") === "on",
        rolloutPercentage: Number(form.get("rolloutPercentage")),
      }, "تم تحديث الميزة.")} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-3"><div><strong>{text(feature.name)}</strong><p className="mt-1 text-sm text-slate-500">{text(feature.description)}</p></div><label className="flex items-center gap-2"><input name="enabled" type="checkbox" defaultChecked={Boolean(feature.enabled)} /> تشغيل</label></div>
        <label className="mt-4 block text-sm">نسبة التفعيل التدريجي<input name="rolloutPercentage" type="number" min="0" max="100" defaultValue={Number(feature.rolloutPercentage ?? 100)} className="mt-1 block w-full rounded-lg border px-3 py-2 dark:bg-slate-900" /></label>
        {canManage ? <button disabled={busy} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white">حفظ</button> : null}
      </form>)}
    </section> : null}

    {tab === "roles" ? <section className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">{data.roles.map((role) => <div key={role.id} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><div className="flex justify-between"><strong>{text(role.name)}</strong><code className="text-xs">{text(role.key)}</code></div><p className="mt-2 text-sm text-slate-500">{text(role.description)}</p><p className="mt-3 text-xs">{(permissionsByRole.get(role.id) ?? []).join(" · ") || "لا توجد صلاحيات"}</p></div>)}</div>
      {canManage ? <form action={async (form) => mutate({
        operation: "role.upsert",
        key: form.get("key"),
        name: form.get("name"),
        description: form.get("description"),
        enabled: true,
        permissions: form.getAll("permissions"),
      }, "تم إنشاء الدور.")} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
        <h3 className="mb-4 font-semibold">دور مخصص جديد</h3>
        <div className="grid gap-3 md:grid-cols-3"><input name="key" required placeholder="support_manager" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="name" required placeholder="مدير الدعم" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="description" placeholder="وصف الدور" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /></div>
        <div className="mt-4 grid gap-2 md:grid-cols-3">{ALL_PERMISSIONS.map((permission) => <label key={permission} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-900"><input name="permissions" type="checkbox" value={permission} />{permission}</label>)}</div>
        <button disabled={busy} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white">إنشاء الدور</button>
      </form> : null}
      {canManage && data.roles.length && data.members.length ? <form action={async (form) => mutate({ operation: "role.assign", organizationMemberId: form.get("memberId"), roleId: form.get("roleId") }, "تم إسناد الدور.")} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><h3 className="mb-4 font-semibold">إسناد دور مخصص</h3><div className="grid gap-3 md:grid-cols-2"><select name="memberId" className="rounded-lg border px-3 py-2 dark:bg-slate-900">{data.members.map((member) => <option key={member.id} value={member.id}>{text(member.name) || text(member.email)} · {text(member.baseRole)}</option>)}</select><select name="roleId" className="rounded-lg border px-3 py-2 dark:bg-slate-900">{data.roles.map((role) => <option key={role.id} value={role.id}>{text(role.name)}</option>)}</select></div><button disabled={busy} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white">إسناد</button></form> : null}
    </section> : null}

    {tab === "notifications" ? <section className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">{data.templates.map((template) => <div key={template.id} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><div className="flex justify-between"><strong>{text(template.name)}</strong><span className="text-xs">{text(template.channel)}</span></div><p className="mt-2 text-sm">{text(template.body)}</p><p className="mt-2 text-xs text-slate-500">حدث: {text(template.eventKey)} · متغيرات: {Array.isArray(template.variables) ? template.variables.join(", ") : ""}</p></div>)}</div>
      {canManage ? <form action={async (form) => mutate({
        operation: "template.upsert",
        key: form.get("key"), name: form.get("name"), channel: form.get("channel"), eventKey: form.get("eventKey"), locale: "ar",
        subject: form.get("subject") || null, body: form.get("body"), variables: text(form.get("variables")).split(",").map((value) => value.trim()).filter(Boolean),
        whatsappTemplateName: form.get("whatsappTemplateName") || null, whatsappTemplateStatus: "not_submitted", enabled: true,
      }, "تم حفظ القالب.")} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><h3 className="mb-4 font-semibold">قالب إشعار جديد</h3><div className="grid gap-3 md:grid-cols-2"><input name="key" required placeholder="order_created_whatsapp" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="name" required placeholder="إنشاء طلب" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><select name="channel" className="rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="whatsapp">WhatsApp</option><option value="internal">داخلي</option><option value="email">Email</option><option value="push">Push</option></select><input name="eventKey" required placeholder="order.created" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="subject" placeholder="العنوان" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="variables" placeholder="name,order_id,status" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="whatsappTemplateName" placeholder="اسم قالب Meta المعتمد" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><textarea name="body" required placeholder="مرحبًا {{name}} تم إنشاء طلبك {{order_id}}" className="min-h-28 rounded-lg border px-3 py-2 dark:bg-slate-900 md:col-span-2" /></div><button disabled={busy} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white">حفظ القالب</button></form> : null}
      <div className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><h3 className="mb-3 font-semibold">آخر عمليات التسليم</h3><div className="space-y-2">{data.deliveries.slice(0, 20).map((delivery) => <div key={delivery.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900"><span>{text(delivery.channel)} → {text(delivery.recipient)}</span><span>{text(delivery.status)} {text(delivery.lastErrorCode)}</span></div>)}</div></div>
    </section> : null}

    {tab === "settings" ? <section className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">{data.settings.map((setting) => <div key={setting.id} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><strong>{text(setting.namespace)} / {text(setting.key)}</strong><pre className="mt-3 overflow-auto rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900">{JSON.stringify(setting.value, null, 2)}</pre></div>)}</div>
      {canManage ? <form action={async (form) => {
        let value: unknown = form.get("value");
        try { value = JSON.parse(text(value)); } catch { /* plain string */ }
        await mutate({ operation: "setting.upsert", namespace: form.get("namespace"), key: form.get("key"), value, sensitive: form.get("sensitive") === "on" }, "تم حفظ الإعداد.");
      }} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><h3 className="mb-4 font-semibold">إعداد جديد أو تحديث إعداد</h3><div className="grid gap-3 md:grid-cols-3"><input name="namespace" defaultValue="general" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="key" required placeholder="site_name" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="value" required placeholder='"منصة معتز" أو JSON' className="rounded-lg border px-3 py-2 dark:bg-slate-900" /></div><label className="mt-3 flex items-center gap-2 text-sm"><input name="sensitive" type="checkbox" /> قيمة حساسة لا تُعاد للواجهة</label><button disabled={busy} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white">حفظ</button></form> : null}
    </section> : null}

    {tab === "trash" ? <section className="space-y-3">{data.trash.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><div><strong>{text(item.label) || text(item.resourceId)}</strong><p className="text-xs text-slate-500">{text(item.resourceType)} · {text(item.deletedAt)}</p></div>{canManage ? <div className="flex gap-2"><button disabled={busy} type="button" onClick={() => void mutate({ operation: "trash.restore", id: item.id }, "تم استرجاع العنصر.")} className="rounded-lg border px-3 py-2">استرجاع</button><button disabled={busy} type="button" onClick={() => void mutate({ operation: "trash.purge", id: item.id }, "تم الحذف النهائي.")} className="rounded-lg border border-red-300 px-3 py-2 text-red-700">حذف نهائي</button></div> : null}</div>)}</section> : null}

    {notice ? <p className="rounded-xl bg-slate-100 p-3 text-sm dark:bg-slate-900">{notice}</p> : null}
  </div>;
}
