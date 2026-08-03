"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, Cloud, Loader2, Palette, X } from "lucide-react";
import {
  chatThemeOptions,
  chatWallpaperOptions,
  type ChatAppearance,
  type ChatThemeId,
  type ChatWallpaperId,
} from "@/lib/chat/appearance";
import { groupConversations } from "@/lib/chat/conversation-groups";
import { getPuterClient } from "@/lib/puter/client";
import { streamPuterChat } from "@/lib/puter/chat";
import { listPuterModels } from "@/lib/puter/models";
import type { ClientAIModel, PuterChatMessage } from "@/lib/puter/types";

type Agent = { id: string; name: string };
type Conversation = {
  id: string;
  title: string | null;
  agentId: string;
  agentName: string;
  summary?: string | null;
  status?: string;
  pinnedAt?: string | null;
  archivedAt?: string | null;
  lastMessageAt?: string | null;
  providerCredentialId?: string | null;
  model?: string | null;
  createdAt?: string;
  updatedAt: string;
};
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "sending" | "streaming" | "completed" | "failed" | "interrupted" | "cancelled";
  createdAt: string;
  completedAt?: string | null;
  requestId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  errorCode?: string | null;
  model?: string | null;
  editedAt?: string | null;
  metadata?: Record<string, unknown>;
  attachments?: Attachment[];
};
type Attachment = { id: string; filename: string; mimeType: string; sizeBytes: number; processingStatus?: string };
type FailedUpload = { id: string; file: File; message: string };
type ModelOption = { providerCredentialId: string; providerName: string; model: string; freeTierEligible: boolean };
type Api<T> = { success?: boolean; data?: T; error?: { code?: string; message?: string; requestId?: string } };

export function ChatConsole({ agents, initialConversations, initialConversationId, initialAppearance, puterEnabled }: {
  agents: Agent[];
  initialConversations: Conversation[];
  initialConversationId?: string;
  initialAppearance: ChatAppearance;
  puterEnabled: boolean;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [conversationId, setConversationId] = useState(
    initialConversations.some((item) => item.id === initialConversationId)
      ? initialConversationId ?? ""
      : initialConversations[0]?.id ?? "",
  );
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(initialConversations.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [retryText, setRetryText] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [failedUploads, setFailedUploads] = useState<FailedUpload[]>([]);
  const [search, setSearch] = useState("");
  const [archivedMode, setArchivedMode] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [draft, setDraft] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("auto");
  const [executionMode, setExecutionMode] = useState<"server" | "puter">("server");
  const [puterModels, setPuterModels] = useState<ClientAIModel[]>([]);
  const [puterModel, setPuterModel] = useState("");
  const [puterModelsLoading, setPuterModelsLoading] = useState(false);
  const [puterConnected, setPuterConnected] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [pendingPuterText, setPendingPuterText] = useState<string | null>(null);
  const [appearance, setAppearance] = useState(initialAppearance);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [savingAppearance, setSavingAppearance] = useState(false);
  const streamController = useRef<AbortController | null>(null);
  const puterExecutionRef = useRef<{ executionId: string; userMessageId: string; model: string } | null>(null);
  const scrollAnchor = useRef<HTMLDivElement | null>(null);
  const conversationGroups = useMemo(() => groupConversations(conversations), [conversations]);

  async function connectPuter(forceModels = false) {
    if (!puterEnabled) return;
    setPuterModelsLoading(true);
    setError(null);
    try {
      const client = await getPuterClient();
      if (!client.auth.isSignedIn()) await client.auth.signIn();
      const available = await listPuterModels({ force: forceModels, client });
      setPuterModels(available);
      setPuterModel((current) => available.some((item) => item.id === current) ? current : available[0]?.id ?? "");
      setPuterConnected(true);
    } catch (cause) {
      setPuterConnected(false);
      setError(cause instanceof Error ? cause.message : "تعذر الاتصال بـPuter.");
    } finally {
      setPuterModelsLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoadingConversations(true);
      const query = new URLSearchParams({ limit: "100" });
      if (archivedMode) query.set("archived", "true");
      if (search.trim()) query.set("q", search.trim());
      fetch(`/api/dashboard/chat?${query.toString()}`, { signal: controller.signal })
        .then(async (response) => ({ response, result: await response.json().catch(() => null) as Api<Conversation[]> | null }))
        .then(({ response, result }) => {
          if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? "تعذر تحميل المحادثات.");
          setConversations((result.data ?? []).map((row) => ({
            ...row,
            updatedAt: new Date(row.updatedAt).toISOString(),
            lastMessageAt: row.lastMessageAt ? new Date(row.lastMessageAt).toISOString() : null,
            pinnedAt: row.pinnedAt ? new Date(row.pinnedAt).toISOString() : null,
            archivedAt: row.archivedAt ? new Date(row.archivedAt).toISOString() : null,
          })));
        })
        .catch((cause) => {
          if (!(cause instanceof DOMException && cause.name === "AbortError")) {
            setError(cause instanceof Error ? cause.message : "تعذر تحميل المحادثات.");
          }
        })
        .finally(() => setLoadingConversations(false));
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [archivedMode, search]);

  useEffect(() => {
    fetch("/api/dashboard/models").then(async (response) => {
      const result = await response.json().catch(() => null) as Api<ModelOption[]> | null;
      if (response.ok && result?.success) setModels(result.data ?? []);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    const controller = new AbortController();
    fetch(`/api/dashboard/chat?conversationId=${encodeURIComponent(conversationId)}&limit=100`, { signal: controller.signal })
      .then(async (response) => ({ response, result: await response.json().catch(() => null) as Api<Message[]> | null }))
      .then(({ response, result }) => {
        if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? "تعذر تحميل الرسائل.");
        setMessages(result.data ?? []);
      })
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(cause instanceof Error ? cause.message : "تعذر تحميل الرسائل.");
        }
      })
      .finally(() => setLoadingMessages(false));
    return () => controller.abort();
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const timeout = window.setTimeout(() => {
      setDraft(localStorage.getItem(`chat-draft:${conversationId}`) ?? "");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const timeout = window.setTimeout(() => {
      if (draft) localStorage.setItem(`chat-draft:${conversationId}`, draft);
      else localStorage.removeItem(`chat-draft:${conversationId}`);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [conversationId, draft]);

  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function selectConversation(id: string) {
    if (id === conversationId || loading) return;
    setMessages([]);
    setRetryText(null);
    setError(null);
    setNotice(null);
    setAttachments([]);
    setLoadingMessages(true);
    setConversationId(id);
  }

  async function conversationAction(body: Record<string, unknown>) {
    const response = await fetch("/api/dashboard/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null) as Api<Conversation & { deleted?: boolean }> | null;
    if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? "تعذر تحديث المحادثة.");
    return result.data;
  }

  async function createConversation() {
    if (!agentId || loading) return;
    setLoading(true);
    setError(null);
    try {
      const created = await conversationAction({ action: "create", agentId });
      if (!created) throw new Error("تعذر إنشاء المحادثة.");
      const agentName = agents.find((agent) => agent.id === agentId)?.name ?? "وكيل";
      const row: Conversation = { ...created, agentName, status: "active", pinnedAt: null, archivedAt: null, lastMessageAt: null, updatedAt: new Date(created.updatedAt).toISOString() };
      setConversations((current) => [row, ...current]);
      setMessages([]);
      setLoadingMessages(true);
      setConversationId(row.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إنشاء المحادثة.");
    } finally {
      setLoading(false);
    }
  }

  async function renameConversation(row: Conversation) {
    const title = window.prompt("العنوان الجديد", row.title ?? "");
    if (!title?.trim()) return;
    try {
      const updated = await conversationAction({ action: "rename", conversationId: row.id, title });
      if (updated) setConversations((items) => items.map((item) => item.id === row.id ? { ...item, title: updated.title } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تغيير الاسم.");
    }
  }

  async function archiveConversation(row: Conversation) {
    try {
      await conversationAction({ action: "archive", conversationId: row.id, archived: true });
      const remaining = conversations.filter((item) => item.id !== row.id);
      setConversations(remaining);
      if (conversationId === row.id) setConversationId(remaining[0]?.id ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر أرشفة المحادثة.");
    }
  }

  async function restoreConversation(row: Conversation) {
    try {
      await conversationAction({ action: "archive", conversationId: row.id, archived: false });
      setConversations((items) => items.filter((item) => item.id !== row.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر استعادة المحادثة.");
    }
  }

  async function pinConversation(row: Conversation) {
    try {
      const updated = await conversationAction({ action: "pin", conversationId: row.id, pinned: !row.pinnedAt });
      if (updated) setConversations((items) => items.map((item) => item.id === row.id ? {
        ...item,
        pinnedAt: updated.pinnedAt ? new Date(updated.pinnedAt).toISOString() : null,
        updatedAt: new Date(updated.updatedAt).toISOString(),
      } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تثبيت المحادثة.");
    }
  }

  async function deleteConversation(row: Conversation) {
    if (!window.confirm("نقل المحادثة إلى المحذوفات؟ يمكن استعادتها وفق سياسة الاحتفاظ.")) return;
    try {
      await conversationAction({ action: "delete", conversationId: row.id });
      const remaining = conversations.filter((item) => item.id !== row.id);
      setConversations(remaining);
      if (conversationId === row.id) setConversationId(remaining[0]?.id ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حذف المحادثة.");
    }
  }

  async function readEventStream(response: Response, optimisticId: string) {
    if (!response.body) throw new Error("لم يبدأ الخادم بث الاستجابة.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assistantId = `stream-${Date.now()}`;
    let sawServerMessage = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const event = block.split(/\r?\n/).find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
        const dataText = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!dataText) continue;
        const data = JSON.parse(dataText) as Record<string, unknown>;
        if (event === "message" && data.userMessage) {
          const serverMessage = data.userMessage as Message;
          sawServerMessage = true;
          setMessages((items) => items.map((item) => item.id === optimisticId ? serverMessage : item));
        } else if (event === "run" && typeof data.runId === "string") {
          setRunId(data.runId);
          assistantId = `stream-${data.runId}`;
          setMessages((items) => [...items, { id: assistantId, role: "assistant", content: "", status: "streaming", createdAt: new Date().toISOString() }]);
        } else if (event === "delta" && typeof data.text === "string") {
          setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, content: item.content + data.text } : item));
        } else if (event === "complete" && typeof data.messageId === "string") {
          const fallbackUsed = data.fallbackUsed === true;
          setMessages((items) => items.map((item) => item.id === assistantId ? {
            ...item,
            id: String(data.messageId),
            status: "completed",
            metadata: { ...(item.metadata ?? {}), fallbackUsed },
          } : item));
          setNotice(fallbackUsed ? "تعذر إكمال الطلب بالمزوّد الأول، فتم استخدام مزوّد بديل وفق سياسة fallback المفعّلة." : null);
          setRetryText(null);
        } else if (event === "error") {
          setMessages((items) => items.map((item) => item.id === assistantId ? {
            ...item,
            status: item.content.trim() ? "interrupted" : "failed",
            errorCode: typeof data.code === "string" ? data.code : "PROVIDER_REQUEST_FAILED",
          } : item));
          throw new Error(typeof data.message === "string" ? data.message : "تعذر تشغيل الوكيل.");
        }
      }
    }
    if (!sawServerMessage) {
      const refresh = await fetch(`/api/dashboard/chat?conversationId=${encodeURIComponent(conversationId)}&limit=100`);
      const result = await refresh.json().catch(() => null) as Api<Message[]> | null;
      if (refresh.ok && result?.success) setMessages(result.data ?? []);
    }
  }

  async function uploadOne(file: File, failedId?: string) {
    const form = new FormData();
    form.set("conversationId", conversationId);
    form.set("file", file);
    const response = await fetch("/api/dashboard/files", { method: "POST", body: form });
    const payload = await response.json().catch(() => null) as Api<Attachment> | null;
    if (!response.ok || !payload?.success || !payload.data) {
      throw new Error(payload?.error?.message ?? `تعذر رفع ${file.name}.`);
    }
    setAttachments((current) => current.some((item) => item.id === payload.data!.id)
      ? current
      : [...current, payload.data!].slice(0, 8));
    if (failedId) setFailedUploads((items) => items.filter((item) => item.id !== failedId));
  }

  async function uploadFiles(files: FileList | File[] | null) {
    if (!files || !conversationId) return;
    const selected = Array.from(files).slice(0, Math.max(0, 8 - attachments.length));
    if (selected.length === 0) return;
    setUploading(true);
    setError(null);
    const results = await Promise.allSettled(selected.map((file) => uploadOne(file)));
    const failures = results.flatMap((result, index) => result.status === "rejected"
      ? [{ id: crypto.randomUUID(), file: selected[index], message: result.reason instanceof Error ? result.reason.message : "تعذر رفع الملف." }]
      : []);
    if (failures.length) {
      setFailedUploads((items) => [...items, ...failures]);
      setError(`فشل رفع ${failures.length} ملف. يمكنك إعادة محاولة كل ملف أدناه.`);
    }
    setUploading(false);
  }

  async function removePendingAttachment(file: Attachment) {
    setAttachments((items) => items.filter((item) => item.id !== file.id));
    const response = await fetch("/api/dashboard/files", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: file.id }),
    });
    if (!response.ok) {
      setAttachments((items) => [...items, file]);
      const payload = await response.json().catch(() => null) as Api<never> | null;
      setError(payload?.error?.message ?? `تعذر حذف ${file.filename}.`);
    }
  }

  async function retryUpload(item: FailedUpload) {
    setUploading(true);
    setError(null);
    try {
      await uploadOne(item.file, item.id);
    } catch (cause) {
      setFailedUploads((items) => items.map((failed) => failed.id === item.id
        ? { ...failed, message: cause instanceof Error ? cause.message : "تعذر رفع الملف." }
        : failed));
      setError(cause instanceof Error ? cause.message : "تعذر رفع الملف.");
    } finally {
      setUploading(false);
    }
  }

  async function sendServerText(text: string) {
    if (!conversationId || loading || !text.trim()) return;
    const optimisticId = `local-${crypto.randomUUID()}`;
    const optimistic: Message = {
      id: optimisticId,
      role: "user",
      content: text.trim(),
      createdAt: new Date().toISOString(),
      attachments: [...attachments],
      status: "sending",
    };
    setMessages((current) => [...current, optimistic]);
    setLoading(true);
    setError(null);
    setNotice(null);
    setRetryText(null);
    const controller = new AbortController();
    streamController.current = controller;
    try {
      const response = await fetch("/api/dashboard/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: text.trim(),
          attachmentIds: attachments.map((file) => file.id),
          clientRequestId: crypto.randomUUID(),
          inputKind: attachments.length ? "file" : "text",
          ...(selectedModel === "auto" ? {} : {
            providerCredentialId: selectedModel.split(":", 1)[0],
            model: selectedModel.slice(selectedModel.indexOf(":") + 1),
          }),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as Api<never> | null;
        throw new Error(result?.error?.message ?? "تعذر تشغيل الوكيل.");
      }
      await readEventStream(response, optimisticId);
      setAttachments([]);
      setDraft("");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setMessages((items) => items.map((item) => item.status === "streaming" ? { ...item, status: "cancelled" } : item));
        setError("تم إيقاف التوليد.");
      } else {
        setMessages((items) => items.map((item) => item.status === "streaming" ? {
          ...item,
          status: item.content.trim() ? "interrupted" : "failed",
        } : item));
        setError(cause instanceof Error ? cause.message : "تعذر تشغيل الوكيل.");
        setRetryText(text.trim());
      }
    } finally {
      setLoading(false);
      setRunId(null);
      streamController.current = null;
    }
  }

  async function finishPuterExecution(input: {
    executionId: string;
    userMessageId: string;
    model: string;
    status: "completed" | "failed" | "cancelled";
    content?: string;
  }) {
    const response = await fetch("/api/dashboard/chat/puter", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, ...input }),
    });
    const result = await response.json().catch(() => null) as Api<{ assistantMessage: Message | null }> | null;
    if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? "تعذر حفظ نتيجة Puter.");
    return result.data?.assistantMessage ?? null;
  }

  async function sendPuterText(text: string) {
    if (!conversationId || loading || !text.trim() || !puterModel) return;
    const optimisticId = `local-${crypto.randomUUID()}`;
    const assistantId = `stream-puter-${crypto.randomUUID()}`;
    setMessages((current) => [...current, {
      id: optimisticId, role: "user", content: text.trim(), status: "sending", createdAt: new Date().toISOString(), attachments: [],
    }]);
    setLoading(true);
    setError(null);
    setNotice(null);
    setRetryText(null);
    const controller = new AbortController();
    streamController.current = controller;
    try {
      const client = await getPuterClient();
      if (!client.auth.isSignedIn()) throw new Error("اتصل بحساب Puter قبل بدء الدردشة.");
      const response = await fetch("/api/dashboard/chat/puter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: text.trim(),
          model: puterModel,
          clientRequestId: crypto.randomUUID(),
        }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => null) as Api<{
        executionId: string;
        userMessage: Message;
        messages: PuterChatMessage[];
      }> | null;
      if (!response.ok || !result?.success || !result.data) throw new Error(result?.error?.message ?? "تعذر بدء دردشة Puter.");
      const execution = { executionId: result.data.executionId, userMessageId: result.data.userMessage.id, model: puterModel };
      puterExecutionRef.current = execution;
      setMessages((items) => [...items.map((item) => item.id === optimisticId ? result.data!.userMessage : item), {
        id: assistantId, role: "assistant", content: "", status: "streaming", model: puterModel, createdAt: new Date().toISOString(),
        metadata: { provider: "puter", executionSource: "client" },
      }]);
      const finalText = await streamPuterChat({
        client,
        messages: result.data.messages,
        model: puterModel,
        signal: controller.signal,
        onText(delta) {
          setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, content: item.content + delta } : item));
        },
      });
      const saved = await finishPuterExecution({ ...execution, status: "completed", content: finalText });
      if (saved) setMessages((items) => items.map((item) => item.id === assistantId ? saved : item));
      setRetryText(null);
      setDraft("");
    } catch (cause) {
      const execution = puterExecutionRef.current;
      const cancelled = cause instanceof DOMException && cause.name === "AbortError";
      if (execution) {
        await finishPuterExecution({ ...execution, status: cancelled ? "cancelled" : "failed" }).catch(() => undefined);
      }
      setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, status: cancelled ? "cancelled" : item.content.trim() ? "interrupted" : "failed" } : item));
      setError(cancelled ? "تم إيقاف تحديث استجابة Puter." : cause instanceof Error ? cause.message : "تعذر تشغيل Puter.");
      if (!cancelled) setRetryText(text.trim());
    } finally {
      puterExecutionRef.current = null;
      streamController.current = null;
      setLoading(false);
    }
  }

  async function sendText(text: string) {
    if (executionMode === "puter") {
      if (localStorage.getItem("moataz:puter:privacy-consent") !== "accepted") {
        setPendingPuterText(text.trim());
        setPrivacyOpen(true);
        return;
      }
      await sendPuterText(text);
      return;
    }
    await sendServerText(text);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const text = String(new FormData(form).get("message") ?? "").trim();
    if (!text) return;
    form.reset();
    setDraft("");
    await sendText(text);
  }

  async function stop() {
    streamController.current?.abort();
    if (executionMode === "server" && runId) {
      await fetch("/api/dashboard/runs", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
      }).catch(() => undefined);
    }
  }

  async function mutateMessage(message: Message, action: "edit" | "delete") {
    if (action === "delete" && !window.confirm("حذف هذه الرسالة؟")) return;
    const content = action === "edit" ? window.prompt("عدّل الرسالة ثم أعد توليد الرد", message.content)?.trim() : undefined;
    if (action === "edit" && !content) return;
    const response = await fetch("/api/dashboard/messages", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, messageId: message.id, ...(content ? { content } : {}) }),
    });
    const result = await response.json().catch(() => null) as Api<Message> | null;
    if (!response.ok || !result?.success) {
      setError(result?.error?.message ?? "تعذر تحديث الرسالة.");
      return;
    }
    if (action === "delete") setMessages((items) => items.filter((item) => item.id !== message.id));
    else {
      setMessages((items) => items.map((item) => item.id === message.id ? { ...item, content: content ?? item.content, editedAt: new Date().toISOString() } : item));
      await sendText(content!);
    }
  }

  async function saveAppearance(next: ChatAppearance) {
    const previous = appearance;
    setAppearance(next);
    setSavingAppearance(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard/chat/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      const result = await response.json().catch(() => null) as Api<ChatAppearance> | null;
      if (!response.ok || !result?.success || !result.data) {
        throw new Error(result?.error?.message ?? "تعذر حفظ مظهر المحادثة.");
      }
      setAppearance(result.data);
    } catch (cause) {
      setAppearance(previous);
      setError(cause instanceof Error ? cause.message : "تعذر حفظ مظهر المحادثة.");
    } finally {
      setSavingAppearance(false);
    }
  }

  function selectTheme(theme: ChatThemeId) {
    if (theme !== appearance.theme) void saveAppearance({ ...appearance, theme });
  }

  function selectWallpaper(wallpaper: ChatWallpaperId) {
    if (wallpaper !== appearance.wallpaper) void saveAppearance({ ...appearance, wallpaper });
  }

  const activeConversation = conversations.find((item) => item.id === conversationId);

  return (
    <div className="grid gap-5 xl:grid-cols-[310px_minmax(0,1fr)]">
      <aside className="soft-card p-4 xl:sticky xl:top-5 xl:max-h-[calc(100vh-2.5rem)] xl:overflow-y-auto">
        <div className="flex items-center justify-between"><div><p className="eyebrow">Workspace</p><h2 className="mt-1 font-black">المحادثات</h2></div><span className="nav-icon">✦</span></div>
        <div className="mt-4 grid gap-2">
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="form-control" placeholder="بحث في المحادثات…" aria-label="بحث في المحادثات" />
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)} className="form-control">
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
          <button onClick={createConversation} disabled={loading || agents.length === 0} className="primary-button disabled:opacity-50">محادثة جديدة</button>
        </div>
        {agents.length === 0 ? <p className="mt-3 text-sm text-amber-100">انشر وكيلًا أولًا.</p> : null}
        <div className="mt-4 grid grid-cols-2 gap-2" role="tablist" aria-label="حالة المحادثات">
          <button type="button" role="tab" aria-selected={!archivedMode} className={!archivedMode ? "primary-button" : "secondary-button"} onClick={() => setArchivedMode(false)}>النشطة</button>
          <button type="button" role="tab" aria-selected={archivedMode} className={archivedMode ? "primary-button" : "secondary-button"} onClick={() => setArchivedMode(true)}>الأرشيف</button>
        </div>
        <div className="mt-5 space-y-4" aria-busy={loadingConversations}>
          {conversationGroups.map((group) => <section key={group.key} aria-labelledby={`conversation-group-${group.key}`}>
            <h3 id={`conversation-group-${group.key}`} className="mb-2 px-1 text-xs font-bold text-[var(--text-secondary)]">{group.label}</h3>
            <div className="space-y-2">
              {group.items.map((row) => <article key={row.id} className={`conversation-row ${row.id === conversationId ? "conversation-row-active" : ""}`}>
                <button onClick={() => selectConversation(row.id)} className="w-full px-1 py-1 text-right text-sm">
                  <span className="flex items-center gap-2 truncate font-semibold">{row.pinnedAt ? <span aria-label="مثبت">★</span> : null}{row.title || "محادثة"}</span>
                  <span className="mt-1 block truncate text-xs" style={{ color: "var(--text-secondary)" }}>{row.agentName}{row.model ? ` · ${row.model}` : ""}</span>
                  <span className="mt-1 block text-[11px]" style={{ color: "var(--text-secondary)" }}>{new Date(row.lastMessageAt ?? row.updatedAt).toLocaleString("ar")}</span>
                </button>
                <div className="mt-2 flex flex-wrap gap-1 border-t pt-2" style={{ borderColor: "var(--border)" }}>
                  <button className="chat-action" onClick={() => renameConversation(row)}>✎ تسمية</button>
                  {!archivedMode ? <button className="chat-action" onClick={() => void pinConversation(row)}>{row.pinnedAt ? "☆ إلغاء التثبيت" : "★ تثبيت"}</button> : null}
                  {archivedMode
                    ? <button className="chat-action" onClick={() => void restoreConversation(row)}>↺ استعادة</button>
                    : <button className="chat-action" onClick={() => void archiveConversation(row)}>▣ أرشفة</button>}
                  <button className="chat-action chat-action-danger" onClick={() => void deleteConversation(row)}>⌫ حذف ناعم</button>
                </div>
              </article>)}
            </div>
          </section>)}
          {loadingConversations ? <p className="text-center text-xs text-[var(--text-secondary)]">جارٍ تحديث القائمة…</p> : null}
          {!loadingConversations && conversations.length === 0 ? <p className="rounded-2xl border border-dashed border-stone-700 p-6 text-center text-sm text-stone-500">{archivedMode ? "لا توجد محادثات مؤرشفة." : "لا توجد محادثات بعد."}</p> : null}
        </div>
      </aside>
      <section className="soft-card flex min-h-[680px] flex-col overflow-hidden">
        <div className="chat-header relative border-b p-4 sm:p-5" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3"><span className="brand-mark !mb-0 !h-10 !w-10">AI</span><div className="min-w-0"><h2 className="truncate font-black">{activeConversation?.title || "دردشة الوكيل"}</h2><p className="mt-1 truncate text-xs" style={{ color: "var(--text-secondary)" }}>{activeConversation?.agentName ? `الوكيل: ${activeConversation.agentName}` : "اختر محادثة أو أنشئ واحدة"} — بث مباشر وحفظ تلقائي</p></div></div>
            <button type="button" className="appearance-trigger" onClick={() => setAppearanceOpen((value) => !value)} aria-expanded={appearanceOpen} aria-controls="chat-appearance-panel">
              <Palette size={18} aria-hidden="true" />
              <span className="hidden sm:inline">مظهر المحادثة</span>
            </button>
          </div>
          {appearanceOpen ? (
            <section id="chat-appearance-panel" className="chat-appearance-panel" aria-label="اختيار مظهر المحادثة">
              <div className="flex items-center justify-between gap-3">
                <div><h3 className="font-bold">خصّص محادثاتك</h3><p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>يُحفظ الاختيار في حسابك ويظهر على كل أجهزتك.</p></div>
                <button type="button" className="icon-button" onClick={() => setAppearanceOpen(false)} aria-label="إغلاق"><X size={18} /></button>
              </div>
              <p className="appearance-label">الثيم</p>
              <div className="appearance-theme-grid">
                {chatThemeOptions.map((option) => (
                  <button key={option.id} type="button" disabled={savingAppearance} onClick={() => selectTheme(option.id)}
                    className={`appearance-theme appearance-preview-${option.id}${appearance.theme === option.id ? " appearance-selected" : ""}`}>
                    <span className="appearance-swatch"><i /><i /></span>
                    <span><b>{option.label}</b><small>{option.description}</small></span>
                    {appearance.theme === option.id ? <Check size={17} aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
              <p className="appearance-label">الخلفية</p>
              <div className="appearance-wallpapers">
                {chatWallpaperOptions.map((option) => (
                  <button key={option.id} type="button" disabled={savingAppearance} onClick={() => selectWallpaper(option.id)}
                    className={`appearance-wallpaper chat-wallpaper-${option.id}${appearance.wallpaper === option.id ? " appearance-selected" : ""}`}>
                    <span>{option.label}</span>
                    {appearance.wallpaper === option.id ? <Check size={15} aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
        <div className={`chat-stage chat-theme-${appearance.theme} chat-wallpaper-${appearance.wallpaper} flex-1 space-y-4 overflow-y-auto p-4 sm:p-6`} aria-live="polite">
          {loadingMessages ? <div className="skeleton h-20 rounded-3xl" /> : null}
          {messages.map((message) => (
            <article key={message.id} className={`chat-message ${message.role === "user" ? "chat-message-user" : "chat-message-assistant"}`} style={{
              marginLeft: message.role === "user" ? "auto" : undefined,
              marginRight: message.role === "assistant" ? "auto" : undefined,
            }}>
              <p className="whitespace-pre-wrap">{message.content || (message.status === "streaming" || message.status === "sending" ? "…" : "")}</p>
              {message.status && message.status !== "completed" ? <p className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-1 text-xs" role={message.status === "failed" || message.status === "interrupted" ? "alert" : "status"}>
                {message.status === "sending" ? "جارٍ الإرسال"
                  : message.status === "streaming" ? "جارٍ البث"
                    : message.status === "cancelled" ? "أُلغي الطلب"
                      : message.status === "interrupted" ? "انقطع البث؛ النص الظاهر جزئي وغير مكتمل"
                        : "فشل الطلب ولم تُحفظ إجابة ناجحة"}
                {message.errorCode ? ` — ${message.errorCode}` : ""}
              </p> : null}
              {message.attachments?.length ? (
                <div className="mt-3 grid gap-2">
                  {message.attachments.map((file) => (
                    <a key={file.id} href={`/api/dashboard/files?id=${encodeURIComponent(file.id)}`}
                      className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs"
                      style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                      <span className="min-w-0 truncate">📎 {file.filename}</span>
                      <span className="shrink-0" style={{ color: file.processingStatus === "ready" ? "var(--success)" : "var(--warning)" }}>
                        {file.processingStatus === "ready" ? "جاهز ومفهرس" : file.processingStatus ?? "محفوظ"}
                      </span>
                    </a>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 flex items-center gap-3 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                <time>{new Date(message.createdAt).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}</time>
                {message.content ? <button type="button" onClick={() => navigator.clipboard.writeText(message.content)}>نسخ</button> : null}
                {message.role === "user" && !message.id.startsWith("local-") ? <button type="button" onClick={() => mutateMessage(message, "edit")}>تعديل وإعادة توليد</button> : null}
                {!message.id.startsWith("stream-") && !message.id.startsWith("local-") ? <button type="button" onClick={() => mutateMessage(message, "delete")}>حذف</button> : null}
                {message.model ? <span>{message.model}</span> : null}
                {message.latencyMs !== null && message.latencyMs !== undefined ? <span>{message.latencyMs}ms</span> : null}
                {message.inputTokens !== null && message.inputTokens !== undefined ? <span>دخل: {message.inputTokens}</span> : null}
                {message.outputTokens !== null && message.outputTokens !== undefined ? <span>خرج: {message.outputTokens}</span> : null}
              </div>
            </article>
          ))}
          <div ref={scrollAnchor} />
        </div>
        <form onSubmit={send} className="chat-composer border-t p-4" style={{ borderColor: "var(--border)" }}>
          <textarea
            name="message"
            required
            maxLength={30000}
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={!conversationId || loading}
            placeholder="اكتب طلبك… Enter للإرسال وShift+Enter لسطر جديد"
            className="form-control w-full resize-none"
          />
          {attachments.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {attachments.map((file) => (
                <span key={file.id} className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--border)", background: "var(--surface-soft)" }}>
                  {file.filename} ({Math.ceil(file.sizeBytes / 1024)}KB)
                  <button type="button" className="mr-2 text-rose-200" aria-label={`حذف ${file.filename}`} onClick={() => removePendingAttachment(file)}>×</button>
                </span>
              ))}
            </div>
          ) : null}
          {failedUploads.length > 0 ? (
            <div className="mt-3 grid gap-2">
              {failedUploads.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--danger)", background: "var(--surface-soft)" }}>
                  <span><strong>{item.file.name}</strong> — {item.message}</span>
                  <span className="flex gap-2">
                    <button type="button" className="secondary-button px-3 py-1" disabled={uploading} onClick={() => retryUpload(item)}>إعادة المحاولة</button>
                    <button type="button" className="danger-button px-3 py-1" onClick={() => setFailedUploads((items) => items.filter((failed) => failed.id !== item.id))}>إزالة</button>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {puterEnabled ? <select
                className="form-control max-w-56 text-sm"
                value={executionMode}
                onChange={(event) => {
                  const mode = event.target.value === "puter" ? "puter" : "server";
                  setExecutionMode(mode);
                  setAttachments([]);
                  if (mode === "puter" && !puterModels.length) void connectPuter();
                }}
                aria-label="مصدر تنفيذ الدردشة"
              >
                <option value="server">مزوّد الوكيل الخادمي</option>
                <option value="puter">Puter — من المتصفح</option>
              </select> : null}
              {executionMode === "puter" ? <>
                <select className="form-control max-w-72 text-sm" value={puterModel} onChange={(event) => setPuterModel(event.target.value)} aria-label="نموذج Puter" disabled={puterModelsLoading}>
                  <option value="">اختر نموذج Puter</option>
                  {puterModels.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.provider}</option>)}
                </select>
                <button type="button" className="secondary-button px-3 py-2 text-xs" disabled={puterModelsLoading} onClick={() => void connectPuter(true)}>
                  {puterModelsLoading ? <Loader2 className="animate-spin" size={14} /> : <Cloud size={14} />} {puterConnected ? "تحديث Puter" : "الاتصال بـPuter"}
                </button>
              </> :               <select className="form-control max-w-72 text-sm" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} aria-label="النموذج">
                <option value="auto">اختيار تلقائي حسب القدرات</option>
                {models.map((item) => <option key={`${item.providerCredentialId}:${item.model}`} value={`${item.providerCredentialId}:${item.model}`}>
                  {item.providerName} — {item.model}{item.freeTierEligible ? " (مجاني)" : ""}
                </option>)}
              </select>}
              <label className={`secondary-button text-sm ${executionMode === "puter" ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
                {uploading ? "جارٍ الرفع…" : "إرفاق ملفات"}
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  disabled={!conversationId || loading || uploading || attachments.length >= 8 || executionMode === "puter"}
                  accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.docx,.txt,.md,.csv,.json,.xlsx,.pptx,.mp3,.wav,.ogg,.m4a,.mp4,.webm,.mov,.zip,.rar,.7z"
                  onChange={(event) => {
                    uploadFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
              {error ? <p role="alert" className="text-sm text-rose-100">{error}</p> : null}
              {notice ? <p role="status" className="text-sm text-amber-100">{notice}</p> : null}
              {retryText && !loading ? <button type="button" className="mt-2 text-sm text-emerald-100 underline" onClick={() => sendText(retryText)}>إعادة المحاولة</button> : null}
            </div>
            {loading ? (
              <button type="button" onClick={stop} className="danger-button">إيقاف التوليد</button>
            ) : (
              <button disabled={!conversationId || uploading || (executionMode === "puter" && (!puterModel || !puterConnected))} className="primary-button disabled:opacity-50">إرسال</button>
            )}
          </div>
        </form>
      </section>
      {privacyOpen ? <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/70 p-4" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setPrivacyOpen(false); }}>
        <section className="modal-card max-w-lg" role="dialog" aria-modal="true" aria-labelledby="puter-privacy-title">
          <h2 id="puter-privacy-title" className="text-xl font-extrabold">قبل استخدام Puter</h2>
          <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">سيُرسل نص طلبك وسياق المحادثة الضروري إلى Puter وإلى مزوّد النموذج الذي يختاره Puter. لا ترسل أسرار المؤسسة أو مفاتيح API أو بيانات اعتماد.</p>
          <p className="mt-2 text-xs leading-6 text-[var(--text-secondary)]">تنفيذ النموذج يحدث من جلسة متصفحك، ويُحتسب الاستخدام على حساب Puter الخاص بك.</p>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" className="secondary-button" onClick={() => { setPrivacyOpen(false); setPendingPuterText(null); }}>إلغاء</button>
            <button type="button" className="primary-button" autoFocus onClick={() => {
              localStorage.setItem("moataz:puter:privacy-consent", "accepted");
              const pending = pendingPuterText;
              setPrivacyOpen(false);
              setPendingPuterText(null);
              if (pending) void sendPuterText(pending);
            }}>أفهم وأتابع</button>
          </div>
        </section>
      </div> : null}
    </div>
  );
}
