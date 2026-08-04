"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Download, Eye, File, FileImage, FileText, RefreshCw, Search, Trash2, UploadCloud, X } from "lucide-react";
import { Alert, Button, EmptyState, Input, Skeleton, StatusBadge } from "@/components/ui";
import { apiErrorMessage, apiRequest, type ApiEnvelope } from "@/lib/http/client";
import { acceptedFileInput, humanFileSize, isImageMime, validateClientFile } from "@/lib/files/validation";

type FileItem = {
  id: string;
  conversationId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  source: string;
  detectedType?: string | null;
  processingStatus: "pending" | "processing" | "ready" | "failed" | "quarantined";
  processingErrorCode?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type UploadTask = {
  id: string;
  file: globalThis.File;
  progress: number;
  status: "queued" | "uploading" | "completed" | "failed" | "cancelled";
  error?: string;
};

function uploadFile(
  task: UploadTask,
  onProgress: (progress: number) => void,
): { promise: Promise<FileItem>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<FileItem>((resolve, reject) => {
    xhr.open("POST", "/api/dashboard/files");
    xhr.withCredentials = true;
    xhr.setRequestHeader("x-request-id", crypto.randomUUID());
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onerror = () => reject(new Error("تعذر الاتصال بالخادم أثناء رفع الملف."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    xhr.onload = () => {
      let payload: ApiEnvelope<FileItem> | null = null;
      try { payload = JSON.parse(xhr.responseText) as ApiEnvelope<FileItem>; } catch { payload = null; }
      if (xhr.status >= 200 && xhr.status < 300 && payload?.success) resolve(payload.data);
      else if (payload && !payload.success) reject(new Error(payload.error.message));
      else reject(new Error(`تعذر رفع الملف (HTTP ${xhr.status}).`));
    };
    const form = new FormData();
    form.set("file", task.file);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

export function FileManager({ initialItems, canManage }: { initialItems: FileItem[]; canManage: boolean }) {
  const [items, setItems] = useState(initialItems);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [preview, setPreview] = useState<FileItem | null>(null);
  const aborters = useRef(new Map<string, () => void>());

  async function load(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: "100" });
      if (search.trim()) query.set("q", search.trim());
      if (archived) query.set("archived", "true");
      const rows = await apiRequest<FileItem[]>(`/api/dashboard/files?${query}`, { signal });
      setItems(rows);
    } catch (cause) {
      if (!signal?.aborted) setError(apiErrorMessage(cause, "تعذر تحميل الملفات."));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void load(controller.signal), 250);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, archived]);

  useEffect(() => () => {
    for (const abort of aborters.current.values()) abort();
  }, []);

  async function startTask(task: UploadTask) {
    setUploads((current) => current.map((item) => item.id === task.id ? { ...item, status: "uploading", progress: 0, error: undefined } : item));
    const operation = uploadFile(task, (progress) => {
      setUploads((current) => current.map((item) => item.id === task.id ? { ...item, progress } : item));
    });
    aborters.current.set(task.id, operation.abort);
    try {
      const created = await operation.promise;
      setUploads((current) => current.map((item) => item.id === task.id ? { ...item, status: "completed", progress: 100 } : item));
      setItems((current) => [created, ...current]);
      setNotice(`تم رفع ${task.file.name} وحفظه بنجاح.`);
    } catch (cause) {
      const cancelled = cause instanceof DOMException && cause.name === "AbortError";
      setUploads((current) => current.map((item) => item.id === task.id ? {
        ...item,
        status: cancelled ? "cancelled" : "failed",
        error: cancelled ? "أُلغي الرفع." : apiErrorMessage(cause, "تعذر رفع الملف."),
      } : item));
    } finally {
      aborters.current.delete(task.id);
    }
  }

  function queueFiles(files: FileList | File[]) {
    const tasks = Array.from(files).slice(0, 12).map((file) => {
      const validation = validateClientFile(file);
      return {
        id: crypto.randomUUID(),
        file,
        progress: 0,
        status: validation.valid ? "queued" as const : "failed" as const,
        ...(validation.valid ? {} : { error: validation.message }),
      };
    });
    setUploads((current) => [...tasks, ...current].slice(0, 24));
    for (const task of tasks) if (task.status === "queued") void startTask(task);
  }

  async function mutate(item: FileItem, action: "archive" | "restore" | "delete") {
    setError(null);
    try {
      if (action === "delete") {
        await apiRequest("/api/dashboard/files", { method: "DELETE", body: { id: item.id } });
        setItems((current) => current.filter((file) => file.id !== item.id));
        setNotice(`تم حذف ${item.filename}.`);
      } else {
        await apiRequest("/api/dashboard/files", { method: "PATCH", body: { id: item.id, action } });
        setItems((current) => current.filter((file) => file.id !== item.id));
        setNotice(action === "archive" ? `تمت أرشفة ${item.filename}.` : `تمت استعادة ${item.filename}.`);
      }
    } catch (cause) {
      setError(apiErrorMessage(cause, "تعذر تحديث الملف."));
    }
  }

  const activeUploads = useMemo(() => uploads.filter((item) => item.status !== "completed"), [uploads]);

  return (
    <div className="grid gap-5">
      <section
        className={`file-drop-zone${dragging ? " file-drop-zone-active" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          queueFiles(event.dataTransfer.files);
        }}
      >
        <UploadCloud size={30} aria-hidden="true" />
        <div>
          <h2>رفع ملفات إلى مساحة العمل</h2>
          <p>اسحب الملفات هنا أو اخترها. الحد الافتراضي 10MB للملف، والتحقق النهائي يتم في الخادم.</p>
        </div>
        <label className="primary-button cursor-pointer">
          اختيار ملفات
          <input type="file" multiple className="sr-only" accept={acceptedFileInput} onChange={(event) => {
            if (event.target.files) queueFiles(event.target.files);
            event.target.value = "";
          }} />
        </label>
      </section>

      {error ? <Alert tone="danger" title="تعذر إكمال العملية">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {activeUploads.length ? <section className="page-section">
        <header className="page-section-header"><div><h2>عمليات الرفع</h2><p>تقدم حقيقي من المتصفح إلى الخادم مع إمكانية الإلغاء وإعادة المحاولة.</p></div></header>
        <div className="page-section-body grid gap-3">
          {activeUploads.map((task) => (
            <article key={task.id} className="upload-row">
              <File size={18} aria-hidden="true" />
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-3 text-xs"><strong className="truncate">{task.file.name}</strong><span>{humanFileSize(task.file.size)}</span></div>
                <div className="upload-progress" aria-label={`تقدم رفع ${task.file.name}`}><i style={{ width: `${task.progress}%` }} /></div>
                {task.error ? <p role="alert">{task.error}</p> : null}
              </div>
              <div className="flex gap-2">
                {task.status === "uploading" ? <Button size="sm" variant="ghost" onClick={() => aborters.current.get(task.id)?.()}>إلغاء</Button> : null}
                {task.status === "failed" || task.status === "cancelled" ? <Button size="sm" variant="secondary" onClick={() => void startTask(task)}><RefreshCw size={14} /> إعادة</Button> : null}
                <Button size="sm" variant="ghost" aria-label={`إزالة ${task.file.name}`} onClick={() => setUploads((current) => current.filter((item) => item.id !== task.id))}><X size={14} /></Button>
              </div>
            </article>
          ))}
        </div>
      </section> : null}

      <section className="page-section">
        <header className="page-section-header file-manager-toolbar">
          <div><h2>{archived ? "الملفات المؤرشفة" : "الملفات النشطة"}</h2><p>المحتوى محفوظ في التخزين المهيأ بالخادم ويخضع لعزل المؤسسة.</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="file-search"><Search size={16} /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم الملف" aria-label="بحث الملفات" /></label>
            <Button variant="secondary" size="sm" onClick={() => setArchived((value) => !value)}><Archive size={15} /> {archived ? "النشطة" : "المؤرشفة"}</Button>
          </div>
        </header>
        <div className="page-section-body">
          {loading ? <div className="grid gap-3"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : items.length ? (
            <div className="file-grid">
              {items.map((item) => (
                <article className="file-card" key={item.id}>
                  <div className="file-card-preview">
                    {isImageMime(item.mimeType) ? <Image src={`/api/dashboard/files?id=${encodeURIComponent(item.id)}&preview=true`} alt="" width={480} height={260} unoptimized /> : <FileImage size={30} aria-hidden="true" />}
                  </div>
                  <div className="file-card-body">
                    <div className="flex items-start justify-between gap-3"><h3 title={item.filename}>{item.filename}</h3><StatusBadge status={item.processingStatus} label={item.processingStatus === "ready" ? "جاهز" : item.processingStatus} /></div>
                    <p><bdi dir="ltr">{item.mimeType}</bdi> · {humanFileSize(item.sizeBytes)}</p>
                    <p>رُفع {new Date(item.createdAt).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" })}</p>
                    {item.processingErrorCode ? <p className="text-[var(--danger)]">{item.processingErrorCode}</p> : null}
                  </div>
                  <div className="file-card-actions">
                    {(isImageMime(item.mimeType) || item.mimeType === "application/pdf") ? <Button size="sm" variant="ghost" onClick={() => setPreview(item)}><Eye size={14} /> معاينة</Button> : null}
                    <a className="ui-button ui-button-sm secondary-button" href={`/api/dashboard/files?id=${encodeURIComponent(item.id)}`}><Download size={14} /> تنزيل</a>
                    {item.conversationId ? <Link className="ui-button ui-button-sm ui-button-ghost" href={`/dashboard/chat?conversationId=${encodeURIComponent(item.conversationId)}`}>المحادثة</Link> : null}
                    <Button size="sm" variant="ghost" onClick={() => void mutate(item, archived ? "restore" : "archive")}><Archive size={14} /> {archived ? "استعادة" : "أرشفة"}</Button>
                    {canManage ? <Button size="sm" variant="danger" onClick={() => window.confirm(`حذف ${item.filename} نهائيًا؟`) && void mutate(item, "delete")}><Trash2 size={14} /> حذف</Button> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : <EmptyState title="لا توجد ملفات" description={archived ? "لا توجد ملفات مؤرشفة مطابقة." : "ارفع ملفًا من المنطقة أعلاه أو أرفقه من داخل محادثة."} icon={<FileTextIcon />} />}
        </div>
      </section>

      {preview ? <div className="preview-overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setPreview(null); }}>
        <section className="preview-dialog" role="dialog" aria-modal="true" aria-label={`معاينة ${preview.filename}`}>
          <header><div><h2>{preview.filename}</h2><p>{humanFileSize(preview.sizeBytes)} · <bdi dir="ltr">{preview.mimeType}</bdi></p></div><Button variant="ghost" size="sm" onClick={() => setPreview(null)} aria-label="إغلاق المعاينة"><X size={18} /></Button></header>
          {isImageMime(preview.mimeType) ? <div className="preview-image"><Image src={`/api/dashboard/files?id=${encodeURIComponent(preview.id)}&preview=true`} alt={preview.filename} width={1400} height={1000} unoptimized /></div> : <iframe title={preview.filename} src={`/api/dashboard/files?id=${encodeURIComponent(preview.id)}&preview=true`} />}
        </section>
      </div> : null}
    </div>
  );
}

function FileTextIcon() {
  return <FileText size={22} aria-hidden="true" />;
}
