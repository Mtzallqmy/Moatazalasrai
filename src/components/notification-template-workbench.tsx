"use client";

import { useEffect, useMemo, useState } from "react";

type Template = {
  id: string;
  key: string;
  name: string;
  channel: "whatsapp" | "email" | "push" | "internal";
  eventKey: string;
  locale: string;
  subject: string | null;
  body: string;
  variables: string[];
  whatsappTemplateName: string | null;
  whatsappTemplateStatus: string;
  enabled: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function unwrap(value: unknown) {
  const root = record(value);
  return root.data && typeof root.data === "object" ? record(root.data) : root;
}

function readPath(values: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, values);
}

function preview(template: string, values: Record<string, unknown>) {
  return template.replace(/{{\s*([A-Za-z0-9_.-]{1,80})\s*}}/g, (_match, key: string) => {
    const value = readPath(values, key);
    return value === undefined || value === null ? `⟦${key}⟧` : String(value);
  });
}

export function NotificationTemplateWorkbench({ canManage }: { canManage: boolean }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [samples, setSamples] = useState('{"name":"معتز","order_id":"ORD-100","status":"جديد","date":"2026-08-05"}');
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/dashboard/control-plane", { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json?.error?.message || "تعذر تحميل القوالب.");
    const data = unwrap(json);
    const rows = Array.isArray(data.templates) ? data.templates as Template[] : [];
    setTemplates(rows);
    setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id ?? "");
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/dashboard/control-plane", { cache: "no-store" }).then(async (response) => {
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message || "تعذر تحميل القوالب.");
      const data = unwrap(json);
      const rows = Array.isArray(data.templates) ? data.templates as Template[] : [];
      if (active) {
        setTemplates(rows);
        setSelectedId(rows[0]?.id ?? "");
      }
    }).catch((error: Error) => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, []);

  const selected = useMemo(() => templates.find((template) => template.id === selectedId) ?? null, [templates, selectedId]);
  const values = useMemo(() => {
    try {
      const parsed = JSON.parse(samples);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }, [samples]);

  async function save(form: FormData) {
    if (!selected) return;
    setBusy(true);
    setNotice("");
    try {
      const variables = String(form.get("variables") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
      const response = await fetch("/api/dashboard/control-plane", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "template.upsert",
          id: selected.id,
          key: form.get("key"),
          name: form.get("name"),
          channel: form.get("channel"),
          eventKey: form.get("eventKey"),
          locale: form.get("locale"),
          subject: form.get("subject") || null,
          body: form.get("body"),
          variables,
          whatsappTemplateName: form.get("whatsappTemplateName") || null,
          whatsappTemplateStatus: form.get("whatsappTemplateStatus"),
          enabled: form.get("enabled") === "on",
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message || "تعذر حفظ القالب.");
      setNotice("تم حفظ القالب والتحقق من متغيراته.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ القالب.");
    } finally {
      setBusy(false);
    }
  }

  if (!templates.length) return null;

  return <section className="mt-8 rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
    <div className="panel-header"><div><h2>WhatsApp Template Manager ومحرر الإشعارات</h2><p>تحرير القوالب ومعاينة المتغيرات قبل الحفظ والتفعيل.</p></div></div>
    <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
      <aside className="space-y-2">{templates.map((template) => <button key={template.id} type="button" onClick={() => setSelectedId(template.id)} className={`w-full rounded-xl border p-3 text-right ${selectedId === template.id ? "border-blue-500" : "dark:border-slate-800"}`}><strong className="block">{template.name}</strong><span className="text-xs text-slate-500">{template.channel} · {template.eventKey}</span></button>)}</aside>
      {selected ? <form key={selected.id} action={save} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2"><input name="name" defaultValue={selected.name} required className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="key" defaultValue={selected.key} required dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="eventKey" defaultValue={selected.eventKey} required dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><select name="channel" defaultValue={selected.channel} className="rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="push">Push</option><option value="internal">داخلي</option></select><input name="locale" defaultValue={selected.locale} required dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="subject" defaultValue={selected.subject ?? ""} placeholder="العنوان" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="variables" defaultValue={selected.variables.join(",")} placeholder="name,order_id,status" dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900 md:col-span-2" /><input name="whatsappTemplateName" defaultValue={selected.whatsappTemplateName ?? ""} placeholder="Meta template name" dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><select name="whatsappTemplateStatus" defaultValue={selected.whatsappTemplateStatus} className="rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="not_submitted">غير مرسل</option><option value="pending">قيد المراجعة</option><option value="approved">معتمد</option><option value="rejected">مرفوض</option></select><textarea name="body" defaultValue={selected.body} required className="min-h-36 rounded-lg border px-3 py-2 dark:bg-slate-900 md:col-span-2" /><label className="flex items-center gap-2"><input name="enabled" type="checkbox" defaultChecked={selected.enabled} /> القالب مفعّل</label></div>
        <div className="grid gap-4 lg:grid-cols-2"><label className="text-sm">بيانات المعاينة<textarea value={samples} onChange={(event) => setSamples(event.target.value)} dir="ltr" className="mt-2 min-h-36 w-full rounded-lg border px-3 py-2 font-mono text-xs dark:bg-slate-900" /></label><div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900"><p className="text-xs text-slate-500">المعاينة</p><strong className="mt-2 block">{preview(selected.subject ?? selected.name, values)}</strong><p className="mt-3 whitespace-pre-wrap leading-7">{preview(selected.body, values)}</p></div></div>
        {canManage ? <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-white">حفظ التعديلات</button> : null}
      </form> : null}
    </div>
    {notice ? <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-900">{notice}</p> : null}
  </section>;
}
