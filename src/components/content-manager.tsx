"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Row = Record<string, unknown> & { id: string };
type ContentData = {
  pages: Row[];
  sections: Row[];
  services: Row[];
  menus: Row[];
  menuItems: Row[];
  revisions: Row[];
  trash: Row[];
};
type Tab = "pages" | "sections" | "services" | "menus" | "revisions" | "trash";

type Props = {
  organizationSlug: string;
  canManage: boolean;
  canPublish: boolean;
  canManageServices: boolean;
  canManageMenus: boolean;
  canPurge: boolean;
};

const emptyData: ContentData = { pages: [], sections: [], services: [], menus: [], menuItems: [], revisions: [], trash: [] };

function text(value: unknown) {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function number(value: unknown, fallback = 100) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function unwrap(value: unknown): ContentData {
  const root = record(value);
  return (root.data && typeof root.data === "object" ? root.data : root) as ContentData;
}

function parseObject(value: FormDataEntryValue | null, field: string) {
  const raw = text(value).trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${field}: يجب إدخال JSON Object صالح.`);
  }
}

async function fetchContent() {
  const response = await fetch("/api/dashboard/content", { cache: "no-store" });
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error?.message || "تعذر تحميل إدارة المحتوى.");
  return unwrap(json);
}

export function ContentManager(props: Props) {
  const [data, setData] = useState<ContentData>(emptyData);
  const [tab, setTab] = useState<Tab>("pages");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedPageId, setSelectedPageId] = useState("");

  const apply = useCallback((next: ContentData) => {
    setData(next);
    setSelectedPageId((current) => next.pages.some((page) => page.id === current) ? current : next.pages[0]?.id || "");
  }, []);
  const load = useCallback(async () => apply(await fetchContent()), [apply]);

  useEffect(() => {
    let active = true;
    void fetchContent().then((next) => { if (active) apply(next); }).catch((error: Error) => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, [apply]);

  async function mutate(operation: Record<string, unknown>, success: string) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/dashboard/content", {
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

  const selectedPage = useMemo(() => data.pages.find((page) => page.id === selectedPageId) ?? null, [data.pages, selectedPageId]);
  const selectedSections = useMemo(() => data.sections.filter((section) => text(section.pageId) === selectedPageId), [data.sections, selectedPageId]);
  const menuName = useMemo(() => new Map(data.menus.map((menu) => [menu.id, text(menu.name)])), [data.menus]);
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "pages", label: "الصفحات" },
    { id: "sections", label: "الأقسام" },
    { id: "services", label: "الخدمات" },
    { id: "menus", label: "القوائم" },
    { id: "revisions", label: "الإصدارات" },
    { id: "trash", label: "المحذوفات" },
  ];

  return <div className="space-y-5">
    <div className="flex flex-wrap gap-2 rounded-2xl border bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
      {tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`rounded-xl px-4 py-2 text-sm ${tab === item.id ? "bg-blue-600 text-white" : "bg-slate-100 dark:bg-slate-900"}`}>{item.label}</button>)}
    </div>

    {tab === "pages" ? <section className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">{data.pages.map((page) => <form key={page.id} action={async (form) => mutate({
        operation: "page.upsert",
        id: page.id,
        slug: form.get("slug"),
        title: form.get("title"),
        excerpt: form.get("excerpt") || null,
        status: form.get("status"),
        template: form.get("template"),
        position: Number(form.get("position")),
        seo: record(page.seo),
        settings: record(page.settings),
        changeSummary: "تحديث من لوحة إدارة المحتوى",
      }, "تم تحديث الصفحة.")} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-4 flex items-start justify-between gap-3"><div><strong>{text(page.title)}</strong><p className="text-xs text-slate-500">/site/{props.organizationSlug}/{text(page.slug)}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs dark:bg-slate-900">{text(page.status)}</span></div>
        <div className="grid gap-3 sm:grid-cols-2"><input name="title" defaultValue={text(page.title)} required className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="slug" defaultValue={text(page.slug)} required dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><textarea name="excerpt" defaultValue={text(page.excerpt)} className="min-h-20 rounded-lg border px-3 py-2 dark:bg-slate-900 sm:col-span-2" /><select name="status" defaultValue={text(page.status)} className="rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="draft">مسودة</option><option value="published">منشورة</option><option value="hidden">مخفية</option><option value="disabled">معطلة</option></select><select name="template" defaultValue={text(page.template)} className="rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="standard">Standard</option><option value="landing">Landing</option><option value="documentation">Documentation</option></select><input name="position" type="number" min="0" defaultValue={number(page.position)} className="rounded-lg border px-3 py-2 dark:bg-slate-900" /></div>
        <div className="mt-4 flex flex-wrap gap-2">{props.canManage ? <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-white">حفظ</button> : null}{props.canPublish ? <button type="button" disabled={busy} onClick={() => void mutate({ operation: "page.upsert", id: page.id, slug: page.slug, title: page.title, excerpt: page.excerpt ?? null, status: "published", template: page.template, position: number(page.position), seo: record(page.seo), settings: record(page.settings), changeSummary: "نشر الصفحة" }, "تم نشر الصفحة.")} className="rounded-lg border px-4 py-2">نشر</button> : null}<a href={`/site/${props.organizationSlug}/${text(page.slug)}`} target="_blank" rel="noreferrer" className="rounded-lg border px-4 py-2">معاينة</a>{props.canManage ? <button type="button" disabled={busy} onClick={() => void mutate({ operation: "page.delete", id: page.id }, "نُقلت الصفحة إلى سلة المحذوفات.")} className="rounded-lg border border-red-300 px-4 py-2 text-red-700">حذف ناعم</button> : null}</div>
      </form>)}</div>
      {props.canManage ? <form action={async (form) => mutate({
        operation: "page.upsert", slug: form.get("slug"), title: form.get("title"), excerpt: form.get("excerpt") || null,
        status: "draft", template: form.get("template"), position: Number(form.get("position")), seo: {}, settings: { showHeader: true, showFooter: true, container: "standard" }, changeSummary: "إنشاء الصفحة",
      }, "تم إنشاء الصفحة.")} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><h3 className="mb-4 font-semibold">صفحة جديدة</h3><div className="grid gap-3 md:grid-cols-4"><input name="title" required placeholder="عنوان الصفحة" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="slug" required placeholder="about-us" dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><select name="template" className="rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="standard">Standard</option><option value="landing">Landing</option><option value="documentation">Documentation</option></select><input name="position" type="number" defaultValue="100" min="0" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><textarea name="excerpt" placeholder="وصف مختصر" className="min-h-20 rounded-lg border px-3 py-2 dark:bg-slate-900 md:col-span-4" /></div><button disabled={busy} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white">إنشاء</button></form> : null}
    </section> : null}

    {tab === "sections" ? <section className="space-y-5">
      <div className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><label className="block text-sm font-medium">الصفحة<select value={selectedPageId} onChange={(event) => setSelectedPageId(event.target.value)} className="mt-2 block w-full rounded-lg border px-3 py-2 dark:bg-slate-900">{data.pages.map((page) => <option key={page.id} value={page.id}>{text(page.title)}</option>)}</select></label></div>
      <div className="space-y-4">{selectedSections.map((section) => <form key={section.id} action={async (form) => mutate({
        operation: "section.upsert", id: section.id, pageId: section.pageId, key: form.get("key"), title: form.get("title") || null,
        status: form.get("status"), position: Number(form.get("position")), payload: { type: form.get("type"), content: parseObject(form.get("content"), "محتوى القسم") },
        settings: record(section.settings), changeSummary: "تحديث القسم",
      }, "تم تحديث القسم.")} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><div className="grid gap-3 md:grid-cols-4"><input name="title" defaultValue={text(section.title)} placeholder="عنوان اختياري" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="key" defaultValue={text(section.key)} required dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><select name="type" defaultValue={text(section.type)} className="rounded-lg border px-3 py-2 dark:bg-slate-900">{["hero","rich_text","features","services","callout","image","faq","cta","custom"].map((type) => <option key={type} value={type}>{type}</option>)}</select><select name="status" defaultValue={text(section.status)} className="rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="active">مفعّل</option><option value="hidden">مخفي</option><option value="disabled">معطل</option></select><input name="position" type="number" min="0" defaultValue={number(section.position)} className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><textarea name="content" dir="ltr" defaultValue={JSON.stringify(section.content, null, 2)} className="min-h-48 rounded-lg border px-3 py-2 font-mono text-xs dark:bg-slate-900 md:col-span-4" /></div><div className="mt-4 flex gap-2">{props.canManage ? <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-white">حفظ</button> : null}{props.canManage ? <button type="button" disabled={busy} onClick={() => void mutate({ operation: "section.delete", id: section.id }, "نُقل القسم إلى سلة المحذوفات.")} className="rounded-lg border border-red-300 px-4 py-2 text-red-700">حذف ناعم</button> : null}</div></form>)}</div>
      {props.canManage && selectedPage ? <form action={async (form) => mutate({
        operation: "section.upsert", pageId: selectedPage.id, key: form.get("key"), title: form.get("title") || null, status: "active", position: Number(form.get("position")),
        payload: { type: form.get("type"), content: parseObject(form.get("content"), "محتوى القسم") }, settings: { width: "standard", alignment: "start" }, changeSummary: "إنشاء القسم",
      }, "تم إنشاء القسم.")} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><h3 className="mb-4 font-semibold">قسم جديد داخل {text(selectedPage.title)}</h3><div className="grid gap-3 md:grid-cols-4"><input name="title" placeholder="عنوان اختياري" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="key" required placeholder="hero-main" dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><select name="type" className="rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="hero">hero</option><option value="rich_text">rich_text</option><option value="features">features</option><option value="services">services</option><option value="callout">callout</option><option value="image">image</option><option value="faq">faq</option><option value="cta">cta</option><option value="custom">custom</option></select><input name="position" type="number" min="0" defaultValue="100" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><textarea name="content" dir="ltr" defaultValue={'{"heading":"عنوان رئيسي","body":"وصف الصفحة"}'} className="min-h-44 rounded-lg border px-3 py-2 font-mono text-xs dark:bg-slate-900 md:col-span-4" /></div><button disabled={busy} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white">إنشاء القسم</button></form> : null}
    </section> : null}

    {tab === "services" ? <section className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">{data.services.map((service) => <form key={service.id} action={async (form) => mutate({ operation: "service.upsert", id: service.id, slug: form.get("slug"), name: form.get("name"), summary: form.get("summary") || null, description: form.get("description") || null, status: form.get("status"), position: Number(form.get("position")), icon: form.get("icon") || null, imageUrl: form.get("imageUrl") || null, actionLabel: form.get("actionLabel") || null, actionUrl: form.get("actionUrl") || null, config: record(service.config), changeSummary: "تحديث الخدمة" }, "تم تحديث الخدمة.")} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><div className="grid gap-3 sm:grid-cols-2"><input name="name" defaultValue={text(service.name)} required className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="slug" defaultValue={text(service.slug)} required dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="summary" defaultValue={text(service.summary)} placeholder="وصف مختصر" className="rounded-lg border px-3 py-2 dark:bg-slate-900 sm:col-span-2" /><textarea name="description" defaultValue={text(service.description)} className="min-h-24 rounded-lg border px-3 py-2 dark:bg-slate-900 sm:col-span-2" /><select name="status" defaultValue={text(service.status)} className="rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="active">مفعلة</option><option value="disabled">معطلة</option><option value="hidden">مخفية</option></select><input name="position" type="number" min="0" defaultValue={number(service.position)} className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="icon" defaultValue={text(service.icon)} placeholder="icon" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="imageUrl" defaultValue={text(service.imageUrl)} placeholder="/image.webp أو https://" dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="actionLabel" defaultValue={text(service.actionLabel)} placeholder="ابدأ الآن" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="actionUrl" defaultValue={text(service.actionUrl)} placeholder="/contact" dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /></div>{props.canManageServices ? <div className="mt-4 flex gap-2"><button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-white">حفظ</button><button type="button" disabled={busy} onClick={() => void mutate({ operation: "service.delete", id: service.id }, "نُقلت الخدمة إلى المحذوفات.")} className="rounded-lg border border-red-300 px-4 py-2 text-red-700">حذف ناعم</button></div> : null}</form>)}</div>
      {props.canManageServices ? <form action={async (form) => mutate({ operation: "service.upsert", slug: form.get("slug"), name: form.get("name"), summary: form.get("summary") || null, description: form.get("description") || null, status: "active", position: Number(form.get("position")), icon: null, imageUrl: null, actionLabel: null, actionUrl: null, config: {}, changeSummary: "إنشاء الخدمة" }, "تم إنشاء الخدمة.")} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><h3 className="mb-4 font-semibold">خدمة جديدة</h3><div className="grid gap-3 md:grid-cols-4"><input name="name" required placeholder="اسم الخدمة" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="slug" required placeholder="consulting" dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="summary" placeholder="وصف مختصر" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="position" type="number" defaultValue="100" min="0" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><textarea name="description" className="min-h-24 rounded-lg border px-3 py-2 dark:bg-slate-900 md:col-span-4" /></div><button disabled={busy} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white">إنشاء</button></form> : null}
    </section> : null}

    {tab === "menus" ? <section className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">{data.menus.map((menu) => <div key={menu.id} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><div className="flex justify-between"><strong>{text(menu.name)}</strong><code className="text-xs">{text(menu.key)}</code></div><div className="mt-4 space-y-2">{data.menuItems.filter((item) => text(item.menuId) === menu.id).map((item) => <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900"><span>{text(item.label)} <small dir="ltr">{text(item.href)}</small></span>{props.canManageMenus ? <button type="button" disabled={busy} onClick={() => void mutate({ operation: "menu_item.delete", id: item.id }, "نُقل عنصر القائمة إلى المحذوفات.")} className="text-red-700">حذف</button> : null}</div>)}</div></div>)}</div>
      {props.canManageMenus ? <div className="grid gap-5 lg:grid-cols-2"><form action={async (form) => mutate({ operation: "menu.upsert", key: form.get("key"), name: form.get("name"), status: "active", settings: { orientation: "horizontal" } }, "تم إنشاء القائمة.")} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><h3 className="mb-4 font-semibold">قائمة جديدة</h3><input name="name" required placeholder="القائمة الرئيسية" className="mb-3 w-full rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="key" required placeholder="primary" dir="ltr" className="w-full rounded-lg border px-3 py-2 dark:bg-slate-900" /><button disabled={busy} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white">إنشاء</button></form><form action={async (form) => mutate({ operation: "menu_item.upsert", menuId: form.get("menuId"), key: form.get("key"), parentKey: null, label: form.get("label"), href: form.get("href") || null, pageId: form.get("pageId") || null, status: "active", position: Number(form.get("position")), settings: { openInNewTab: false } }, "تم إضافة عنصر القائمة.")} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><h3 className="mb-4 font-semibold">عنصر قائمة جديد</h3><div className="grid gap-3 sm:grid-cols-2"><select name="menuId" className="rounded-lg border px-3 py-2 dark:bg-slate-900">{data.menus.map((menu) => <option key={menu.id} value={menu.id}>{text(menu.name)}</option>)}</select><input name="key" required placeholder="about" dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="label" required placeholder="من نحن" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="href" placeholder="/contact أو https://" dir="ltr" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /><select name="pageId" className="rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="">بدون صفحة</option>{data.pages.map((page) => <option key={page.id} value={page.id}>{text(page.title)}</option>)}</select><input name="position" type="number" defaultValue="100" min="0" className="rounded-lg border px-3 py-2 dark:bg-slate-900" /></div><button disabled={busy} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white">إضافة</button></form></div> : null}
    </section> : null}

    {tab === "revisions" ? <section className="space-y-3">{data.revisions.map((revision) => <div key={revision.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><div><strong>{text(revision.resourceType)} · v{number(revision.version, 1)}</strong><p className="text-xs text-slate-500">{text(revision.changeSummary) || text(revision.createdAt)}</p></div>{props.canManage ? <button type="button" disabled={busy} onClick={() => void mutate({ operation: "revision.restore", id: revision.id }, "تم استرجاع الإصدار كنسخة جديدة.")} className="rounded-lg border px-4 py-2">استرجاع الإصدار</button> : null}</div>)}</section> : null}

    {tab === "trash" ? <section className="space-y-3">{data.trash.map((item) => {
      const type = text(item.resourceType);
      const restoreOperation = type === "site_page" ? "page.restore" : type === "site_page_section" ? "section.restore" : type === "site_service" ? "service.restore" : null;
      return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950"><div><strong>{text(item.label) || text(item.resourceId)}</strong><p className="text-xs text-slate-500">{type} · {text(item.deletedAt)}</p></div><div className="flex gap-2">{restoreOperation && props.canManage ? <button type="button" disabled={busy} onClick={() => void mutate({ operation: restoreOperation, id: item.resourceId }, "تم استرجاع العنصر.")} className="rounded-lg border px-4 py-2">استرجاع</button> : null}{type === "site_page" && props.canPurge ? <button type="button" disabled={busy} onClick={() => void mutate({ operation: "page.purge", id: item.resourceId }, "تم حذف الصفحة نهائيًا.")} className="rounded-lg border border-red-300 px-4 py-2 text-red-700">حذف نهائي</button> : null}</div></div>;
    })}</section> : null}

    {notice ? <p className="rounded-xl bg-slate-100 p-3 text-sm dark:bg-slate-900">{notice}</p> : null}
    {busy ? <p className="text-sm text-slate-500">جارٍ حفظ التغييرات…</p> : null}
    <p className="text-xs text-slate-500">القوائم: {data.menus.map((menu) => menuName.get(menu.id)).filter(Boolean).join(" · ") || "لا توجد"}</p>
  </div>;
}
