"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUp, BookOpen, ChevronLeft, FileCode2, Folder, Github, Loader2, Lock, RefreshCw, Search } from "lucide-react";
import { Alert, Button, EmptyState, IconButton, Input, Skeleton, StatusBadge, buttonClass } from "@/components/ui";
import { apiErrorMessage, apiRequest, ApiClientError } from "@/lib/http/client";
import { humanFileSize } from "@/lib/files/validation";

type Repository = {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  language: string | null;
  sizeKb: number | null;
  permissions: { admin?: boolean; push?: boolean; pull?: boolean } | null;
  updatedAt: string;
};
type Entry = { type: "file" | "dir" | "symlink" | "submodule"; name: string; path: string; sha: string; size: number | null; htmlUrl: string | null };
type RepositoryResponse = { integration: { id: string; name: string; login: string | null; lastVerifiedAt: string | null }; repositories: Repository[] };
type ContentsResponse = { kind: "directory"; items: Entry[] } | { kind: "file"; file: { name: string; path: string; sha: string; size: number; content: string; htmlUrl: string | null } };

function parentPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function RepositoryBrowser() {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selected, setSelected] = useState<Repository | null>(null);
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [file, setFile] = useState<Extract<ContentsResponse, { kind: "file" }>["file"] | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [integration, setIntegration] = useState<RepositoryResponse["integration"] | null>(null);

  const loadRepositories = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setNotConfigured(false);
    try {
      const result = await apiRequest<RepositoryResponse>("/api/dashboard/repositories?action=list&limit=50", { signal, timeoutMs: 20_000 });
      setRepositories(result.repositories);
      setIntegration(result.integration);
      setSelected((current) => current && result.repositories.some((item) => item.id === current.id) ? current : result.repositories[0] ?? null);
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.code === "GITHUB_NOT_CONFIGURED") setNotConfigured(true);
      else if (!signal?.aborted) setError(apiErrorMessage(cause, "تعذر تحميل مستودعات GitHub."));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const loadContents = useCallback(async (repository: Repository, nextPath: string, signal?: AbortSignal) => {
    setContentLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ action: "contents", owner: repository.owner, repo: repository.name, path: nextPath, ref: repository.defaultBranch });
      const result = await apiRequest<ContentsResponse>(`/api/dashboard/repositories?${params}`, { signal, timeoutMs: 20_000 });
      setPath(nextPath);
      if (result.kind === "directory") {
        setEntries(result.items);
        setFile(null);
      } else {
        setFile(result.file);
      }
    } catch (cause) {
      if (!signal?.aborted) setError(apiErrorMessage(cause, "تعذر قراءة محتوى المستودع."));
    } finally {
      if (!signal?.aborted) setContentLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadRepositories(controller.signal);
    return () => controller.abort();
  }, [loadRepositories]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void loadContents(selected, "", controller.signal);
    return () => controller.abort();
  }, [selected, loadContents]);

  const visibleRepositories = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("en");
    if (!normalized) return repositories;
    return repositories.filter((repo) => `${repo.fullName} ${repo.description ?? ""} ${repo.language ?? ""}`.toLocaleLowerCase("en").includes(normalized));
  }, [query, repositories]);

  if (notConfigured) {
    return <EmptyState icon={<Github size={24} />} title="GitHub غير مهيأ" description="أضف تكامل GitHub صالحًا واختبر الاتصال. لن تُعرض المستودعات قبل نجاح التحقق الحقيقي." action={<Link className={buttonClass()} href="/dashboard/integrations">فتح التكاملات</Link>} />;
  }

  return (
    <div className="repository-layout">
      <aside className="page-section repository-sidebar">
        <header className="page-section-header"><div><h2>المستودعات</h2><p>{integration?.login ? `الحساب ${integration.login}` : "التكامل الموثق"}</p></div><IconButton label="تحديث المستودعات" onClick={() => void loadRepositories()} disabled={loading}><RefreshCw size={16} /></IconButton></header>
        <div className="page-section-body grid gap-3">
          <label className="file-search"><Search size={16} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالمستودع أو اللغة" aria-label="بحث المستودعات" /></label>
          {loading ? <div className="grid gap-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : visibleRepositories.length ? <div className="repository-list">
            {visibleRepositories.map((repo) => <button type="button" key={repo.id} className={selected?.id === repo.id ? "repository-active" : undefined} onClick={() => setSelected(repo)}>
              <span className="repository-list-title">{repo.private ? <Lock size={13} /> : <Github size={14} />}<bdi dir="ltr">{repo.fullName}</bdi></span>
              <small>{repo.description || repo.language || "دون وصف"}</small>
            </button>)}
          </div> : <EmptyState icon={<Github size={20} />} title="لا توجد مستودعات" description="لم يُرجع GitHub مستودعات يمكن للحساب المتصل قراءتها." />}
        </div>
      </aside>

      <section className="page-section min-w-0 repository-workspace">
        <header className="page-section-header">
          <div><h2>{selected?.fullName ?? "اختر مستودعًا"}</h2><p>{selected ? `${selected.defaultBranch} · ${selected.language ?? "لغة غير محددة"}` : "يُحمّل كل مجلد عند فتحه فقط."}</p></div>
          {selected ? <StatusBadge status="available" label={selected.private ? "خاص" : "عام"} /> : null}
        </header>
        <div className="page-section-body grid gap-4 min-w-0">
          {error ? <Alert tone="danger" action={<Button size="sm" variant="secondary" onClick={() => selected && void loadContents(selected, path)}>إعادة المحاولة</Button>}>{error}</Alert> : null}
          {selected ? <div className="repository-breadcrumbs" aria-label="مسار المستودع">
            <button type="button" onClick={() => void loadContents(selected, "")}><BookOpen size={14} /><bdi dir="ltr">{selected.name}</bdi></button>
            {path.split("/").filter(Boolean).map((part, index, parts) => <button type="button" key={`${part}-${index}`} onClick={() => void loadContents(selected, parts.slice(0, index + 1).join("/"))}><ChevronLeft size={13} /><bdi dir="ltr">{part}</bdi></button>)}
          </div> : null}

          {contentLoading ? <div className="repository-loading"><Loader2 className="animate-spin" size={22} /><span>تحميل المحتوى من GitHub…</span></div> : file ? <div className="repository-file-preview">
            <header><div><FileCode2 size={18} /><span><bdi dir="ltr">{file.path}</bdi><small>{humanFileSize(file.size)}</small></span></div><Button variant="secondary" size="sm" onClick={() => selected && void loadContents(selected, parentPath(file.path))}><ArrowUp size={14} /> المجلد</Button></header>
            <pre dir="ltr" tabIndex={0}><code>{file.content}</code></pre>
          </div> : entries.length ? <div className="repository-entries">
            {path ? <button type="button" className="repository-entry" onClick={() => selected && void loadContents(selected, parentPath(path))}><ArrowUp size={18} /><span><b>..</b><small>المجلد السابق</small></span></button> : null}
            {entries.map((entry) => <button type="button" key={entry.sha + entry.path} className="repository-entry" onClick={() => selected && void loadContents(selected, entry.path)} disabled={entry.type !== "file" && entry.type !== "dir"}>
              {entry.type === "dir" ? <Folder size={19} /> : <FileCode2 size={19} />}
              <span><bdi dir="ltr">{entry.name}</bdi><small>{entry.type === "dir" ? "مجلد" : entry.size == null ? "ملف" : humanFileSize(entry.size)}</small></span>
            </button>)}
          </div> : selected ? <EmptyState icon={<Folder size={22} />} title="المجلد فارغ" description="لا توجد عناصر قابلة للعرض في هذا المسار." /> : <EmptyState icon={<Github size={22} />} title="اختر مستودعًا" description="ستظهر شجرة الملفات الحقيقية هنا بعد اختيار مستودع." />}
          <Alert tone="info" title="نطاق هذه الصفحة">التصفح والمعاينة يعملان مباشرة عبر التكامل المشفر. الفهرسة، checkpoints، citations على مستوى السطر، والمزامنة الخلفية ليست ممثلة كجاهزة لأن المشروع لا يملك لها عقود تخزين أو jobs مكتملة بعد.</Alert>
        </div>
      </section>
    </div>
  );
}
