"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  Copy,
  File,
  FileCode2,
  Folder,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Select, Textarea, buttonClass } from "@/components/ui";

type Workspace = {
  id: string; name: string; status: string; template: string; networkMode: string; diskLimitBytes: number;
  conversationId?: string | null; lastActivityAt: string; errorCode?: string | null;
};
type Execution = {
  id: string; workspaceId: string; conversationId?: string | null; commandSummary: string; status: string;
  riskLevel: "low" | "medium" | "high" | "critical"; currentStep?: number; exitCode?: number | null;
  stdoutBytes: number; stderrBytes: number; outputTruncated: boolean; errorCode?: string | null; errorMessage?: string | null;
  createdAt: string; startedAt?: string | null; completedAt?: string | null;
};
type SandboxEvent = { sequence: number; type: string; stream?: string | null; payload: Record<string, unknown>; createdAt: string };
type FileEntry = { path: string; isDirectory: boolean; sizeBytes: number; mimeType?: string | null; sha256?: string | null; modifiedAt?: string | null };
type Envelope<T> = { success: true; data: T } | { success: false; error: { message: string } };

async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const payload = await response.json() as Envelope<T>;
  if (!response.ok || !payload.success) throw new Error(payload.success ? "فشل الطلب." : payload.error.message);
  return payload.data;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

const statusMeta: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  provisioning: { label: "قيد التجهيز", tone: "warning" }, ready: { label: "جاهزة", tone: "success" }, paused: { label: "متوقفة", tone: "neutral" },
  resetting: { label: "إعادة ضبط", tone: "warning" }, failed: { label: "فشل", tone: "danger" }, terminated: { label: "منتهية", tone: "neutral" },
  queued: { label: "في الصف", tone: "neutral" }, awaiting_approval: { label: "بانتظار الموافقة", tone: "warning" }, running: { label: "يعمل", tone: "warning" },
  completed: { label: "مكتمل", tone: "success" }, cancelled: { label: "ملغى", tone: "neutral" }, timed_out: { label: "انتهت المهلة", tone: "danger" },
};

export function SandboxConsole({ conversationId, compact = false }: { conversationId?: string; compact?: boolean }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [selectedExecutionId, setSelectedExecutionId] = useState("");
  const [events, setEvents] = useState<SandboxEvent[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeTab, setActiveTab] = useState<"terminal" | "files" | "history">("terminal");
  const [command, setCommand] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState(".");
  const [filePath, setFilePath] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [fileEncoding, setFileEncoding] = useState<"utf8" | "base64">("utf8");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmAction, setConfirmAction] = useState<"reset" | "terminate" | "delete-file" | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const terminalRef = useRef<HTMLPreElement | null>(null);

  const workspace = workspaces.find((item) => item.id === workspaceId);
  const selectedExecution = executions.find((item) => item.id === selectedExecutionId);
  const terminalText = useMemo(() => events.map((event) => {
    if (event.type === "output" && typeof event.payload.text === "string") return event.payload.text;
    if (event.type === "status") return `\n[${String(event.payload.status ?? "status")}]\n`;
    return "";
  }).join(""), [events]);

  async function loadWorkspaces() {
    setLoading(true); setError("");
    try {
      const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
      const rows = await api<Workspace[]>(`/api/dashboard/sandbox/workspaces${query}`);
      setWorkspaces(rows);
      const nextId = rows.some((item) => item.id === workspaceId) ? workspaceId : rows[0]?.id ?? "";
      setWorkspaceId(nextId);
      if (nextId) await loadExecutions(nextId);
      else setExecutions([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل Sandbox."); }
    finally { setLoading(false); }
  }

  async function loadExecutions(id = workspaceId) {
    if (!id) return;
    const rows = await api<Execution[]>(`/api/dashboard/sandbox/executions?workspaceId=${encodeURIComponent(id)}&limit=100`);
    setExecutions(rows);
    if (!selectedExecutionId && rows[0]) setSelectedExecutionId(rows[0].id);
  }

  async function loadFiles(path = ".") {
    if (!workspaceId) return;
    try {
      const rows = await api<FileEntry[]>(`/api/dashboard/sandbox/files?mode=list&workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(path)}&depth=5`);
      setFiles(rows);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل الملفات."); }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadWorkspaces(); }, 0);
    return () => {
      window.clearTimeout(timer);
      eventSourceRef.current?.close();
    };
  }, [conversationId]);
  useEffect(() => {
    if (!workspaceId) return;
    const timer = window.setTimeout(() => {
      void loadExecutions(workspaceId);
      if (activeTab === "files") void loadFiles();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [workspaceId]);
  useEffect(() => {
    if (activeTab !== "files" || !workspaceId) return;
    const timer = window.setTimeout(() => { void loadFiles(); }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTab]);
  useEffect(() => {
    eventSourceRef.current?.close();
    let source: EventSource | null = null;
    const timer = window.setTimeout(() => {
      setEvents([]);
      if (!selectedExecutionId) return;
      source = new EventSource(`/api/dashboard/sandbox/events?executionId=${encodeURIComponent(selectedExecutionId)}&after=0&limit=500&stream=1`);
      eventSourceRef.current = source;
      const handler = (event: MessageEvent) => {
        try {
          const value = JSON.parse(event.data) as SandboxEvent;
          if (typeof value.sequence === "number") setEvents((current) => current.some((item) => item.sequence === value.sequence) ? current : [...current, value].sort((a, b) => a.sequence - b.sequence));
        } catch {}
      };
      ["status", "output", "step", "error"].forEach((name) => source?.addEventListener(name, handler));
      source.addEventListener("complete", () => { source?.close(); void loadExecutions(); });
      source.onerror = () => source?.close();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      source?.close();
    };
  }, [selectedExecutionId]);
  useEffect(() => { terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight }); }, [terminalText]);

  async function createWorkspace() {
    if (!conversationId) { setError("أنشئ مساحة Sandbox من داخل محادثة لربط الملفات والسجل بها."); return; }
    setSaving(true); setError("");
    try {
      await api("/api/dashboard/sandbox/workspaces", { method: "POST", body: JSON.stringify({ conversationId, template: "moataz-code", permissions: [] }) });
      await loadWorkspaces();
      window.setTimeout(() => void loadWorkspaces(), 1_500);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر إنشاء المساحة."); }
    finally { setSaving(false); }
  }

  async function execute() {
    if (!workspaceId || !conversationId) return;
    setSaving(true); setError("");
    try {
      const row = await api<Execution>("/api/dashboard/sandbox/executions", {
        method: "POST",
        body: JSON.stringify({ workspaceId, conversationId, command, workingDirectory, idempotencyKey: crypto.randomUUID() }),
      });
      setCommand(""); setSelectedExecutionId(row.id); setActiveTab("terminal");
      await loadExecutions();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تشغيل الأمر."); }
    finally { setSaving(false); }
  }

  async function stopExecution() {
    if (!selectedExecutionId) return;
    setSaving(true);
    try { await api("/api/dashboard/sandbox/executions", { method: "DELETE", body: JSON.stringify({ executionId: selectedExecutionId }) }); await loadExecutions(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر إيقاف التنفيذ."); }
    finally { setSaving(false); }
  }

  async function workspaceAction(action: "reset" | "terminate") {
    if (!workspaceId) return;
    setSaving(true); setError("");
    try {
      await api("/api/dashboard/sandbox/workspaces", { method: action === "terminate" ? "DELETE" : "PATCH", body: JSON.stringify({ workspaceId, action }) });
      setConfirmAction(null); await loadWorkspaces();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تنفيذ العملية."); }
    finally { setSaving(false); }
  }

  async function openFile(path: string) {
    if (!workspaceId) return;
    try {
      const value = await api<{ content: string; encoding: "utf8" | "base64" }>(`/api/dashboard/sandbox/files?mode=read&workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(path)}&maxBytes=1048576`);
      setFilePath(path); setFileContent(value.content); setFileEncoding(value.encoding);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر فتح الملف."); }
  }

  async function saveFile() {
    if (!workspaceId || !filePath) return;
    setSaving(true); setError("");
    try {
      await api("/api/dashboard/sandbox/files", { method: "POST", body: JSON.stringify({ workspaceId, path: filePath, content: fileContent, encoding: fileEncoding, overwrite: true }) });
      await loadFiles();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر حفظ الملف."); }
    finally { setSaving(false); }
  }

  async function deleteFile() {
    if (!workspaceId || !filePath) return;
    setSaving(true);
    try {
      await api("/api/dashboard/sandbox/files", { method: "DELETE", body: JSON.stringify({ workspaceId, path: filePath, recursive: false }) });
      setFilePath(""); setFileContent(""); setConfirmAction(null); await loadFiles();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر حذف الملف."); }
    finally { setSaving(false); }
  }

  return <div className={compact ? "space-y-3" : "space-y-5"}>
    {!compact ? <Card className="p-5 sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="eyebrow">Sandbox الوكيل</p><h1 className="mt-2 text-2xl font-extrabold">بيئة تنفيذ معزولة مرتبطة بالمحادثة</h1><p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--muted)]">الأوامر لا تعمل على خادم Next.js. كل مساحة معزولة للمؤسسة، الشبكة معطلة افتراضيًا، والأوامر الحساسة تتوقف للموافقة.</p></div><Button variant="secondary" onClick={() => void loadWorkspaces()}><RefreshCw size={16} /> تحديث</Button></div></Card> : null}
    {error ? <div role="alert" className="rounded-xl border border-red-300/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200"><CircleAlert className="me-2 inline" size={17} />{error}</div> : null}

    {!workspaces.length && !loading ? <EmptyState title="لا توجد مساحة Sandbox لهذه المحادثة" description="أنشئ مساحة معزولة لإدارة الملفات وتشغيل الأوامر مع سجل دائم." action={conversationId ? <Button disabled={saving} onClick={() => void createWorkspace()}>{saving ? <Loader2 className="animate-spin" size={16} /> : <TerminalSquare size={16} />} إنشاء المساحة</Button> : undefined} /> : <Card className={compact ? "overflow-hidden" : "overflow-hidden p-0"}>
      <div className="flex flex-col gap-3 border-b border-[var(--border)] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2"><TerminalSquare size={19} className="text-[var(--primary-strong)]" /><Select className="max-w-xs" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>{workspace ? <Badge tone={(statusMeta[workspace.status] ?? statusMeta.failed).tone}>{(statusMeta[workspace.status] ?? statusMeta.failed).label}</Badge> : null}</div>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={!workspaceId || workspace?.status !== "ready"} onClick={() => setConfirmAction("reset")}><RotateCcw size={14} /> إعادة ضبط</Button><Button size="sm" variant="danger" disabled={!workspaceId} onClick={() => setConfirmAction("terminate")}><Trash2 size={14} /> إنهاء</Button></div>
      </div>
      <div className="flex border-b border-[var(--border)] p-2">{(["terminal", "files", "history"] as const).map((tab) => <button key={tab} className={`rounded-lg px-4 py-2 text-sm font-bold ${activeTab === tab ? "bg-[var(--primary-soft)] text-[var(--primary-strong)]" : "text-[var(--muted)]"}`} onClick={() => setActiveTab(tab)}>{tab === "terminal" ? "الطرفية" : tab === "files" ? "الملفات" : "سجل التنفيذ"}</button>)}</div>

      {activeTab === "terminal" ? <div className="grid min-h-[420px] lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex min-w-0 flex-col bg-slate-950 text-slate-100"><pre ref={terminalRef} className="min-h-80 flex-1 overflow-auto p-4 text-left font-mono text-xs leading-6" dir="ltr">{terminalText || "$ مساحة العمل جاهزة. لن تُعرض الأسرار هنا.\n"}</pre><div className="border-t border-slate-700 p-3"><div className="flex gap-2"><Input className="border-slate-600 bg-slate-900 text-left text-slate-100" dir="ltr" value={workingDirectory} onChange={(event) => setWorkingDirectory(event.target.value)} aria-label="مجلد العمل" /><Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(terminalText)}><Copy size={14} /></Button></div><div className="mt-2 flex gap-2"><Textarea className="min-h-20 flex-1 border-slate-600 bg-slate-900 text-left font-mono text-slate-100" dir="ltr" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npm test" /><div className="flex flex-col gap-2"><Button disabled={saving || workspace?.status !== "ready" || !command.trim() || !conversationId} onClick={() => void execute()}>{saving ? <Loader2 className="animate-spin" size={15} /> : <Play size={15} />} تشغيل</Button>{selectedExecution && ["queued", "running", "awaiting_approval"].includes(selectedExecution.status) ? <Button variant="danger" onClick={() => void stopExecution()}><Square size={14} /> إيقاف</Button> : null}</div></div></div></div>
        <aside className="border-s border-[var(--border)] p-3"><h3 className="text-sm font-bold">التشغيلات الأخيرة</h3><div className="mt-3 space-y-2">{executions.slice(0, 20).map((execution) => <button key={execution.id} className={`w-full rounded-xl border p-3 text-start ${execution.id === selectedExecutionId ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)]"}`} onClick={() => setSelectedExecutionId(execution.id)}><p className="truncate font-mono text-xs" dir="ltr">{execution.commandSummary}</p><div className="mt-2 flex items-center justify-between"><Badge tone={(statusMeta[execution.status] ?? statusMeta.failed).tone}>{(statusMeta[execution.status] ?? statusMeta.failed).label}</Badge><span className="text-xs text-[var(--muted)]">{execution.riskLevel}</span></div></button>)}</div></aside>
      </div> : null}

      {activeTab === "files" ? <div className="grid min-h-[480px] lg:grid-cols-[320px_minmax(0,1fr)]"><aside className="border-e border-[var(--border)] p-3"><div className="flex items-center justify-between"><h3 className="font-bold">شجرة الملفات</h3><button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => void loadFiles()}><RefreshCw size={14} /></button></div><div className="mt-3 max-h-[430px] overflow-auto">{files.map((entry) => <button key={entry.path} disabled={entry.isDirectory} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start text-sm hover:bg-[var(--panel-muted)] disabled:opacity-70" onClick={() => void openFile(entry.path)}>{entry.isDirectory ? <Folder size={16} className="text-amber-500" /> : <File size={16} className="text-[var(--primary)]" />}<span className="min-w-0 flex-1 truncate" dir="ltr">{entry.path}</span>{!entry.isDirectory ? <span className="text-xs text-[var(--muted)]">{formatBytes(entry.sizeBytes)}</span> : null}</button>)}</div></aside><div className="p-4"><div className="flex flex-col gap-3 sm:flex-row"><Input dir="ltr" value={filePath} onChange={(event) => setFilePath(event.target.value)} placeholder="src/index.ts" /><Select className="sm:w-36" value={fileEncoding} onChange={(event) => setFileEncoding(event.target.value as "utf8" | "base64")}><option value="utf8">UTF-8</option><option value="base64">Base64</option></Select></div><Textarea className="mt-3 min-h-[340px] text-left font-mono text-sm" dir="ltr" value={fileContent} onChange={(event) => setFileContent(event.target.value)} placeholder="محتوى الملف" /><div className="mt-3 flex justify-end gap-2"><Button variant="danger" disabled={!filePath || saving} onClick={() => setConfirmAction("delete-file")}><Trash2 size={15} /> حذف الملف</Button><Button disabled={!filePath || saving} onClick={() => void saveFile()}><FileCode2 size={15} /> حفظ</Button></div></div></div> : null}

      {activeTab === "history" ? <div className="p-4"><div className="space-y-3">{executions.map((execution) => <div key={execution.id} className="rounded-xl border border-[var(--border)] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-mono text-sm" dir="ltr">{execution.commandSummary}</p><Badge tone={(statusMeta[execution.status] ?? statusMeta.failed).tone}>{(statusMeta[execution.status] ?? statusMeta.failed).label}</Badge></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--muted)] sm:grid-cols-4"><span>الخروج: {execution.exitCode ?? "—"}</span><span>stdout: {formatBytes(execution.stdoutBytes)}</span><span>stderr: {formatBytes(execution.stderrBytes)}</span><span>{execution.outputTruncated ? "المخرجات مختصرة" : "المخرجات كاملة"}</span></div>{execution.errorCode ? <p className="mt-2 text-sm text-red-600">{execution.errorCode}: {execution.errorMessage}</p> : null}</div>)}</div></div> : null}
    </Card>}

    {confirmAction ? <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/70 p-4" role="alertdialog" aria-modal="true"><Card className="w-full max-w-md p-6"><CircleAlert className="text-red-600" size={28} /><h2 className="mt-4 text-xl font-bold">{confirmAction === "reset" ? "إعادة ضبط مساحة العمل؟" : confirmAction === "terminate" ? "إنهاء Sandbox وحذف موارده؟" : "حذف الملف نهائيًا؟"}</h2><p className="mt-2 text-sm leading-7 text-[var(--muted)]">{confirmAction === "reset" ? "ستُحذف الملفات والحالة الحالية وتبقى المساحة مرتبطة بالمحادثة." : confirmAction === "terminate" ? "ستنتهي المساحة ولن تعمل الأوامر أو الملفات المرتبطة بها. يبقى سجل التدقيق." : `سيُحذف ${filePath} من مساحة العمل ولا يمكن التراجع.`}</p><div className="mt-6 flex justify-end gap-2"><Button variant="secondary" onClick={() => setConfirmAction(null)}>تراجع</Button><Button variant="danger" disabled={saving} onClick={() => void (confirmAction === "delete-file" ? deleteFile() : workspaceAction(confirmAction))}>{saving ? <Loader2 className="animate-spin" size={15} /> : <Trash2 size={15} />} تأكيد</Button></div></Card></div> : null}
  </div>;
}
