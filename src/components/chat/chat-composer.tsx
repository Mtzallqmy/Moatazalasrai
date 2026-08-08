"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Cloud, FilePlus2, Loader2, RefreshCw, Send, Square, Wrench } from "lucide-react";
import { acceptedFileInput } from "@/lib/files/validation";
import { apiErrorMessage, apiRequest } from "@/lib/http/client";
import type { ClientAIModel } from "@/lib/puter/types";
import { friendlyModelName } from "@/lib/ui/presentation";
import { ChatStatus } from "./chat-status";
import { useDraft } from "./hooks/use-draft";
import { MAX_COMPOSER_ATTACHMENTS, useUploads } from "./hooks/use-uploads";
import type { ComposerSendOptions, KnowledgeBaseOption, ModelOption } from "./types";
import { UploadTray } from "./upload-tray";

export const ChatComposer = memo(function ChatComposer({ conversationId, canWrite, agentsAvailable, generating, streamStatus, streamError, retryText, puterEnabled, ragEnabled, memoryEnabled, onSend, onStop }: {
  conversationId: string;
  canWrite: boolean;
  agentsAvailable: boolean;
  generating: boolean;
  streamStatus: string | null;
  streamError: string | null;
  retryText: string | null;
  puterEnabled: boolean;
  ragEnabled: boolean;
  memoryEnabled: boolean;
  onSend: (options: ComposerSendOptions) => Promise<boolean>;
  onStop: () => Promise<void>;
}) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const modelsLoadedRef = useRef(false);
  const [selectedModel, setSelectedModel] = useState("auto");
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseOption[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const knowledgeLoadedRef = useRef(false);
  const [knowledgeBaseId, setKnowledgeBaseId] = useState("");
  const [useMemory, setUseMemory] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [executionMode, setExecutionMode] = useState<"server" | "puter">("server");
  const [puterModels, setPuterModels] = useState<ClientAIModel[]>([]);
  const [puterModel, setPuterModel] = useState("");
  const [puterLoading, setPuterLoading] = useState(false);
  const [puterConnected, setPuterConnected] = useState(false);
  const [privacyText, setPrivacyText] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const focusFrameRef = useRef<number | null>(null);
  const reportError = useCallback((message: string) => setLocalError(message), []);
  const draft = useDraft(conversationId, canWrite, reportError);
  const uploads = useUploads(conversationId, reportError);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const keyboardOpen = viewport.height < window.innerHeight - 120;
      document.documentElement.dataset.chatKeyboardOpen = keyboardOpen ? "true" : "false";
      document.documentElement.style.setProperty("--chat-visual-height", `${Math.round(viewport.height)}px`);
    };
    update();
    viewport.addEventListener("resize", update, { passive: true });
    return () => {
      viewport.removeEventListener("resize", update);
      delete document.documentElement.dataset.chatKeyboardOpen;
      document.documentElement.style.removeProperty("--chat-visual-height");
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
      if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    };
  }, []);

  const resize = useCallback(() => {
    if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      const node = textareaRef.current;
      if (!node) return;
      node.style.height = "0px";
      node.style.height = `${Math.min(Math.max(node.scrollHeight, 48), 160)}px`;
    });
  }, []);

  useEffect(() => resize(), [draft.draft, resize]);

  const loadModels = useCallback(async (force = false) => {
    if (modelsLoadedRef.current && !force) return;
    setModelsLoading(true);
    setLocalError(null);
    try {
      const rows = await apiRequest<ModelOption[]>("/api/dashboard/models");
      modelsLoadedRef.current = true;
      setModels(rows);
      setSelectedModel((current) => current === "auto" || rows.some((item) => `${item.providerCredentialId}:${item.model}` === current) ? current : "auto");
    } catch (cause) {
      setLocalError(apiErrorMessage(cause, "تعذر تحميل النماذج المتاحة."));
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const loadKnowledge = useCallback(async () => {
    if (!ragEnabled || knowledgeLoadedRef.current) return;
    setKnowledgeLoading(true);
    try {
      const rows = await apiRequest<KnowledgeBaseOption[]>("/api/dashboard/chat/options?kind=knowledge");
      knowledgeLoadedRef.current = true;
      setKnowledgeBases(rows);
    } catch (cause) {
      setLocalError(apiErrorMessage(cause, "تعذر تحميل قواعد المعرفة."));
    } finally {
      setKnowledgeLoading(false);
    }
  }, [ragEnabled]);

  const connectPuter = useCallback(async (force = false) => {
    setPuterLoading(true);
    setLocalError(null);
    try {
      const [{ getPuterClient }, { listPuterModels }] = await Promise.all([
        import("@/lib/puter/client"),
        import("@/lib/puter/models"),
      ]);
      const client = await getPuterClient();
      if (!client.auth.isSignedIn()) await client.auth.signIn();
      const available = await listPuterModels({ force, client });
      setPuterModels(available);
      setPuterModel((current) => available.some((item) => item.id === current) ? current : available[0]?.id ?? "");
      setPuterConnected(true);
    } catch (cause) {
      setPuterConnected(false);
      setLocalError(cause instanceof Error ? cause.message : "تعذر الاتصال بـPuter.");
    } finally {
      setPuterLoading(false);
    }
  }, []);

  const modelGroups = useMemo(() => {
    const groups = new Map<string, ModelOption[]>();
    for (const model of models.filter((item) => item.available)) {
      const key = `${model.providerName} · ${model.provider}`;
      groups.set(key, [...(groups.get(key) ?? []), model]);
    }
    return [...groups.entries()];
  }, [models]);
  const selectedModelInfo = selectedModel === "auto" ? null : models.find((item) => `${item.providerCredentialId}:${item.model}` === selectedModel) ?? null;

  const submitText = useCallback(async (text: string) => {
    const value = text.trim();
    if (!value || generating || uploads.busy) return false;
    if (executionMode === "puter" && localStorage.getItem("moataz:puter:privacy-consent") !== "accepted") {
      setPrivacyText(value);
      return false;
    }
    if (uploads.readyAttachments.some((file) => file.mimeType.startsWith("image/")) && selectedModelInfo && selectedModelInfo.capabilities?.vision !== true) {
      setLocalError("النموذج المختار لا يدعم الصور. اختر نموذجًا مناسبًا أو الاختيار التلقائي.");
      return false;
    }
    const separator = selectedModel.indexOf(":");
    const success = await onSend({
      text: value,
      attachments: uploads.readyAttachments,
      executionMode,
      ...(executionMode === "puter" ? { puterModel } : {}),
      ...(selectedModel !== "auto" && separator > 0 ? { providerCredentialId: selectedModel.slice(0, separator), model: selectedModel.slice(separator + 1) } : {}),
      ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
      useMemory: memoryEnabled && useMemory,
    });
    if (success) {
      uploads.consume();
      draft.clear();
      if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = requestAnimationFrame(() => {
        focusFrameRef.current = null;
        textareaRef.current?.focus();
      });
    }
    return success;
  }, [draft, executionMode, generating, knowledgeBaseId, memoryEnabled, onSend, puterModel, selectedModel, selectedModelInfo, uploads, useMemory]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitText(draft.draft);
  };
  const disabled = !agentsAvailable || !canWrite || !draft.draft.trim() || uploads.busy || generating || executionMode === "puter" && (!puterModel || !puterConnected || uploads.tasks.length > 0);
  const visibleError = localError ?? streamError;
  return (
    <>
      <form onSubmit={submit} className="chat-composer" data-component="chat-composer">
        <textarea ref={textareaRef} name="message" maxLength={30000} rows={1} value={draft.draft} onChange={(event) => draft.setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} disabled={!agentsAvailable || !canWrite || generating} placeholder={!canWrite ? "هذه المحادثة للقراءة فقط" : conversationId ? "اكتب رسالة…" : "اكتب أول رسالة لبدء المحادثة…"} aria-label="رسالة المحادثة" />
        <UploadTray tasks={uploads.tasks} onCancel={uploads.cancel} onRetry={(task) => void uploads.retry(task)} onRemove={(task) => void uploads.remove(task)} />
        {toolsOpen ? <section className="composer-tools-panel" aria-label="أدوات وسياق المحادثة">
          {puterEnabled ? <label><span>مصدر التنفيذ</span><select value={executionMode} onChange={(event) => { const next = event.target.value === "puter" ? "puter" : "server"; if (next === "puter" && uploads.tasks.length) { setLocalError("أزل المرفقات قبل التحويل إلى Puter."); return; } setExecutionMode(next); if (next === "puter" && !puterModels.length) void connectPuter(); }}><option value="server">الوكيل على الخادم</option><option value="puter" disabled={uploads.tasks.length > 0}>Puter من المتصفح</option></select></label> : null}
          {executionMode === "server" && ragEnabled ? <label><span>قاعدة المعرفة</span><select value={knowledgeBaseId} onFocus={() => void loadKnowledge()} onChange={(event) => setKnowledgeBaseId(event.target.value)} disabled={knowledgeLoading}><option value="">{knowledgeLoading ? "جارٍ التحميل…" : "بدون قاعدة معرفة"}</option>{knowledgeBases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label> : null}
          {executionMode === "server" && memoryEnabled ? <label className="composer-checkbox"><input type="checkbox" checked={useMemory} onChange={(event) => setUseMemory(event.target.checked)} /><span><b>ذاكرة الوكيل</b><small>استخدم الذاكرة المسموح بها لهذا الحساب فقط.</small></span></label> : null}
          {executionMode === "puter" ? <div className="puter-tools"><label><span>نموذج Puter</span><select value={puterModel} onChange={(event) => setPuterModel(event.target.value)} disabled={puterLoading}><option value="">اختر نموذجًا</option>{puterModels.map((model) => <option key={model.id} value={model.id}>{model.name} — {model.provider}</option>)}</select></label><button type="button" className="secondary-button" disabled={puterLoading} onClick={() => void connectPuter(true)}>{puterLoading ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />} {puterConnected ? "تحديث الاتصال" : "الاتصال بـPuter"}</button></div> : null}
          {selectedModelInfo && executionMode === "server" ? <div className="model-capabilities"><b>{friendlyModelName(selectedModelInfo.model)}</b><span className="technical-value">{selectedModelInfo.provider} / {selectedModelInfo.model}</span><small>{selectedModelInfo.capabilities?.vision ? "صور · " : ""}{selectedModelInfo.capabilities?.files ? "ملفات · " : ""}{selectedModelInfo.capabilities?.tools ? "أدوات" : ""}</small></div> : null}
        </section> : null}
        <ChatStatus status={streamStatus} error={visibleError} />
        {retryText && !generating ? <button type="button" className="composer-retry" onClick={() => void submitText(retryText)}><RefreshCw size={13} /> إعادة المحاولة</button> : null}
        <div className="composer-toolbar"><div className="composer-toolbar-start">
          <label className={`composer-icon-action${executionMode === "puter" ? " is-disabled" : ""}`} aria-label="إرفاق ملف"><FilePlus2 size={18} aria-hidden="true" /><span>ملف</span><input type="file" multiple className="sr-only" disabled={!conversationId || !canWrite || generating || executionMode === "puter" || uploads.tasks.length >= MAX_COMPOSER_ATTACHMENTS} accept={acceptedFileInput} onChange={(event) => { uploads.add(event.target.files); event.target.value = ""; }} /></label>
          {executionMode === "server" ? <select className="composer-model-select" value={selectedModel} onFocus={() => void loadModels()} onChange={(event) => setSelectedModel(event.target.value)} aria-label="النموذج" disabled={modelsLoading}><option value="auto">{modelsLoading ? "جارٍ تحميل النماذج…" : modelsLoadedRef.current ? "النموذج: تلقائي" : "النموذج: تلقائي (افتح للاختيار)"}</option>{modelGroups.map(([provider, items]) => <optgroup key={provider} label={provider}>{items.map((item) => <option key={`${item.providerCredentialId}:${item.model}`} value={`${item.providerCredentialId}:${item.model}`}>{friendlyModelName(item.model)}{item.freeTierEligible ? " · مجاني" : ""}</option>)}</optgroup>)}</select> : <span className="composer-model-label">{puterModel ? friendlyModelName(puterModel) : "Puter"}</span>}
          {executionMode === "server" && modelsLoadedRef.current && !modelsLoading && models.length === 0 ? <button type="button" className="composer-icon-action" onClick={() => void loadModels(true)}><RefreshCw size={16} /><span>تحديث النماذج</span></button> : null}
          <button type="button" className={toolsOpen ? "composer-icon-action is-active" : "composer-icon-action"} onClick={() => { const next = !toolsOpen; setToolsOpen(next); if (next && ragEnabled) void loadKnowledge(); }} aria-expanded={toolsOpen}><Wrench size={17} /><span>أدوات</span></button>
        </div>{generating ? <button type="button" onClick={() => void onStop()} className="composer-send composer-stop" aria-label="إيقاف التوليد"><Square size={17} fill="currentColor" /><span>إيقاف</span></button> : <button type="submit" disabled={disabled} className="composer-send" aria-label="إرسال الرسالة"><Send size={18} /><span>إرسال</span></button>}</div>
      </form>
      {privacyText ? <div className="mobile-sheet-overlay" role="presentation" onMouseDown={() => setPrivacyText(null)}><section className="mobile-sheet" role="dialog" aria-modal="true" aria-labelledby="puter-privacy-title" onMouseDown={(event) => event.stopPropagation()}><div className="mobile-sheet-handle" /><header className="mobile-sheet-header"><div><h2 id="puter-privacy-title">قبل استخدام Puter</h2><p>سيُرسل سياق المحادثة الضروري إلى Puter ومزوّد النموذج. لا ترسل أسرارًا أو مفاتيح API.</p></div></header><div className="sheet-actions"><button type="button" className="secondary-button" onClick={() => setPrivacyText(null)}>إلغاء</button><button type="button" className="primary-button" onClick={() => { localStorage.setItem("moataz:puter:privacy-consent", "accepted"); const text = privacyText; setPrivacyText(null); void submitText(text); }}>أفهم وأتابع</button></div></section></div> : null}
    </>
  );
});
