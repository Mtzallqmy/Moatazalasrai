"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BookOpen, FilePlus2, RefreshCw, Search, Trash2 } from "lucide-react";
import { Alert, Button, EmptyState, Field, Input, Select, Skeleton, StatusBadge, Textarea } from "@/components/ui";
import { apiErrorMessage, apiRequest } from "@/lib/http/client";
import { humanFileSize } from "@/lib/files/validation";

type KnowledgeBase = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

type KnowledgeDocument = {
  id: string;
  knowledgeBaseId: string;
  attachmentId: string;
  title: string;
  mimeType: string;
  byteSize: number;
  status: "uploaded" | "processing" | "ready" | "failed" | "deleted";
  errorCode?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ReadyFile = { id: string; filename: string; mimeType: string; sizeBytes: number };

export function KnowledgeManager({
  enabled,
  canManage,
  initialBases,
  readyFiles,
}: {
  enabled: boolean;
  canManage: boolean;
  initialBases: KnowledgeBase[];
  readyFiles: ReadyFile[];
}) {
  const [bases, setBases] = useState(initialBases);
  const [selectedId, setSelectedId] = useState(initialBases[0]?.id ?? "");
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [attachmentId, setAttachmentId] = useState(readyFiles[0]?.id ?? "");

  const selected = bases.find((item) => item.id === selectedId) ?? null;
  const filteredBases = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ar");
    if (!query) return bases;
    return bases.filter((item) => `${item.name} ${item.description ?? ""}`.toLocaleLowerCase("ar").includes(query));
  }, [bases, search]);

  async function loadDocuments(signal?: AbortSignal) {
    if (!selectedId || !enabled) return;
    setLoading(true);
    try {
      const rows = await apiRequest<KnowledgeDocument[]>(`/api/knowledge-bases/${encodeURIComponent(selectedId)}/documents`, { signal });
      setDocuments(rows);
    } catch (cause) {
      if (!signal?.aborted) setError(apiErrorMessage(cause, "تعذر تحميل وثائق قاعدة المعرفة."));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadDocuments(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, enabled]);

  useEffect(() => {
    if (!documents.some((item) => item.status === "uploaded" || item.status === "processing")) return;
    const timer = window.setInterval(() => void loadDocuments(), 4_000);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, selectedId]);

  async function createBase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const created = await apiRequest<KnowledgeBase>("/api/knowledge-bases", {
        method: "POST",
        body: { name: data.get("name"), description: data.get("description") || undefined },
      });
      setBases((current) => [created, ...current]);
      setSelectedId(created.id);
      form.reset();
      setNotice("تم إنشاء قاعدة المعرفة.");
    } catch (cause) {
      setError(apiErrorMessage(cause, "تعذر إنشاء قاعدة المعرفة."));
    } finally {
      setBusy(false);
    }
  }

  async function addDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !attachmentId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const data = new FormData(event.currentTarget);
    try {
      const created = await apiRequest<KnowledgeDocument>(`/api/knowledge-bases/${encodeURIComponent(selectedId)}/documents`, {
        method: "POST",
        body: { attachmentId, title: data.get("title") || undefined },
        timeoutMs: 30_000,
      });
      setDocuments((current) => [created, ...current]);
      setNotice("تمت إضافة الوثيقة إلى قائمة المعالجة. ستتحدث الحالة تلقائيًا.");
    } catch (cause) {
      setError(apiErrorMessage(cause, "تعذر إضافة الوثيقة."));
    } finally {
      setBusy(false);
    }
  }

  async function removeDocument(document: KnowledgeDocument) {
    if (!selectedId || !window.confirm(`حذف ${document.title} من قاعدة المعرفة؟`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/knowledge-bases/${encodeURIComponent(selectedId)}/documents`, {
        method: "DELETE",
        body: { documentId: document.id },
      });
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setNotice("تم حذف الوثيقة من قاعدة المعرفة.");
    } catch (cause) {
      setError(apiErrorMessage(cause, "تعذر حذف الوثيقة."));
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return <Alert tone="warning" title="ميزة المعرفة غير مفعلة">اضبط <bdi dir="ltr">AI_RAG_ENABLED=true</bdi> وشغّل الـworker قبل استخدام قواعد المعرفة. لا تعرض الواجهة حالة جاهزة عندما تكون الميزة معطلة.</Alert>;
  }

  return (
    <div className="knowledge-layout">
      <aside className="page-section knowledge-sidebar">
        <header className="page-section-header"><div><h2>قواعد المعرفة</h2><p>{bases.length} قاعدة في مساحة العمل</p></div></header>
        <div className="page-section-body grid gap-3">
          <label className="file-search"><Search size={16} /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث" aria-label="بحث قواعد المعرفة" /></label>
          <div className="knowledge-list">
            {filteredBases.map((item) => <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} className={item.id === selectedId ? "knowledge-list-active" : undefined}>
              <BookOpen size={17} aria-hidden="true" />
              <span><b>{item.name}</b><small>{item.description || "دون وصف"}</small></span>
            </button>)}
            {!filteredBases.length ? <p>لا توجد نتائج.</p> : null}
          </div>
          {canManage ? <form className="grid gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }} onSubmit={createBase}>
            <Field label="قاعدة جديدة" required><Input name="name" required maxLength={100} placeholder="معرفة المنتج" /></Field>
            <Field label="الوصف"><Textarea name="description" maxLength={1000} rows={3} /></Field>
            <Button type="submit" disabled={busy}>إنشاء</Button>
          </form> : null}
        </div>
      </aside>

      <section className="page-section min-w-0">
        <header className="page-section-header">
          <div><h2>{selected?.name ?? "اختر قاعدة معرفة"}</h2><p>{selected?.description ?? "أضف ملفات جاهزة ليعالجها worker ويحوّلها إلى مقاطع قابلة للاسترجاع."}</p></div>
          {selectedId ? <Button size="sm" variant="secondary" onClick={() => void loadDocuments()} disabled={loading}><RefreshCw size={14} /> تحديث</Button> : null}
        </header>
        <div className="page-section-body grid gap-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          {selectedId && canManage ? <form className="knowledge-add-form" onSubmit={addDocument}>
            <Field label="الملف الجاهز" required>
              <Select value={attachmentId} onChange={(event) => setAttachmentId(event.target.value)} required>
                <option value="">اختر ملفًا</option>
                {readyFiles.map((file) => <option value={file.id} key={file.id}>{file.filename} — {humanFileSize(file.sizeBytes)}</option>)}
              </Select>
            </Field>
            <Field label="عنوان اختياري"><Input name="title" maxLength={200} placeholder="يستخدم اسم الملف افتراضيًا" /></Field>
            <Button type="submit" disabled={busy || !attachmentId}><FilePlus2 size={16} /> إضافة ومعالجة</Button>
          </form> : null}
          {selectedId && readyFiles.length === 0 && canManage ? <Alert tone="info">لا توجد ملفات جاهزة غير محذوفة. ارفع ملفًا أولًا من صفحة الملفات.</Alert> : null}

          {loading ? <div className="grid gap-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : documents.length ? <div className="knowledge-documents">
            {documents.map((document) => <article key={document.id}>
              <div className="min-w-0"><h3>{document.title}</h3><p><bdi dir="ltr">{document.mimeType}</bdi> · {humanFileSize(document.byteSize)}</p><p>{new Date(document.createdAt).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" })}</p>{document.errorCode ? <p className="text-[var(--danger)]">{document.errorCode}</p> : null}</div>
              <StatusBadge status={document.status} label={document.status === "ready" ? "جاهز للبحث" : document.status === "processing" ? "قيد المعالجة" : document.status === "uploaded" ? "في الطابور" : document.status} />
              {canManage ? <Button variant="ghost" size="sm" onClick={() => void removeDocument(document)} disabled={busy}><Trash2 size={14} /> حذف</Button> : null}
            </article>)}
          </div> : selectedId ? <EmptyState icon={<BookOpen size={22} />} title="لا توجد وثائق" description="أضف ملفًا جاهزًا إلى قاعدة المعرفة. ستظهر حالة المعالجة الحقيقية هنا." /> : <EmptyState icon={<BookOpen size={22} />} title="اختر قاعدة معرفة" description="حدد قاعدة من القائمة أو أنشئ قاعدة جديدة إذا كانت لديك صلاحية الإدارة." />}
        </div>
      </section>
    </div>
  );
}
