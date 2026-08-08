"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  ArrowDown,
  ArrowRight,
  Check,
  Cloud,
  Copy,
  FilePlus2,
  FileText,
  Loader2,
  MoreHorizontal,
  Palette,
  Pencil,
  Pin,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  Trash2,
  Users,
  Wrench,
  X,
} from "lucide-react";
import {
  chatThemeOptions,
  chatWallpaperOptions,
  type ChatAppearance,
  type ChatThemeId,
  type ChatWallpaperId,
} from "@/lib/chat/appearance";
import { groupConversations } from "@/lib/chat/conversation-groups";
import { splitServerEvents } from "@/lib/chat/sse";
import { acceptedFileInput, humanFileSize, validateClientFile } from "@/lib/files/validation";
import { apiErrorMessage, apiRequest } from "@/lib/http/client";
import { getPuterClient } from "@/lib/puter/client";
import { streamPuterChat } from "@/lib/puter/chat";
import { listPuterModels } from "@/lib/puter/models";
import type { ClientAIModel, PuterChatMessage } from "@/lib/puter/types";
import { friendlyModelName, relativeTime } from "@/lib/ui/presentation";
import { ConversationMembersPanel } from "@/components/conversation-members-panel";
import { MessageContent } from "@/components/message-content";
import { TechnicalDetails } from "@/components/workspace/technical-details";

type Agent = { id: string; name: string };
type KnowledgeBaseOption = { id: string; name: string };
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
  canWrite?: boolean;
  canManage?: boolean;
};
type Message = {
  id: string;
  role: "user" | "assistant";
  authorUserId?: string | null;
  authorName?: string | null;
  authorEmail?: string | null;
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
type Attachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  processingStatus?: string;
  intelligenceStatus?: string;
  chunkCount?: number;
  warnings?: string[];
};
type UploadState = "SELECTED" | "VALIDATING" | "UPLOADING" | "PROCESSING" | "READY" | "PARTIALLY_READY" | "FAILED" | "CANCELLED";
type UploadTask = {
  id: string;
  file: File;
  state: UploadState;
  progress: number | null;
  message?: string | null;
  attachment?: Attachment | null;
};
type ActionDialog =
  | { kind: "rename-conversation"; row: Conversation; value: string }
  | { kind: "delete-conversation"; row: Conversation }
  | { kind: "edit-message"; message: Message; value: string }
  | { kind: "delete-message"; message: Message };
type ModelOption = {
  providerCredentialId: string;
  providerName: string;
  provider: string;
  model: string;
  freeTierEligible: boolean;
  available: boolean;
  latencyMs?: number | null;
  capabilities?: { text?: boolean; vision?: boolean; files?: boolean; tools?: boolean; structuredOutput?: boolean; streaming?: boolean };
};
type Api<T> = { success?: boolean; data?: T; error?: { code?: string; message?: string; requestId?: string } };

const MESSAGE_PAGE_SIZE = 40;
const CONVERSATION_PAGE_SIZE = 50;
const MAX_COMPOSER_ATTACHMENTS = 8;

const uploadLabels: Record<UploadState, string> = {
  SELECTED: "تم الاختيار",
  VALIDATING: "جارٍ التحقق",
  UPLOADING: "جارٍ الرفع",
  PROCESSING: "جارٍ التحليل والفهرسة",
  READY: "جاهز",
  PARTIALLY_READY: "جاهز جزئيًا",
  FAILED: "فشل التحليل أو الرفع",
  CANCELLED: "أُلغي",
};

function metadataString(message: Message, key: string) {
  const value = message.metadata?.[key];
  return typeof value === "string" ? value : null;
}

function toolCallCount(message: Message) {
  const value = message.metadata?.toolCalls;
  return Array.isArray(value) ? value.length : typeof value === "number" ? value : null;
}

function uploadReady(state: UploadState) {
  return state === "READY" || state === "PARTIALLY_READY";
}

function uploadBusy(state: UploadState) {
  return state === "SELECTED" || state === "VALIDATING" || state === "UPLOADING" || state === "PROCESSING";
}

function messageStatusLabel(status: Message["status"]) {
  if (status === "sending") return "جارٍ الإرسال";
  if (status === "streaming") return "جارٍ إنشاء الرد";
  if (status === "cancelled") return "أُلغي الطلب";
  if (status === "interrupted") return "انقطع البث؛ الرد الظاهر غير مكتمل";
  if (status === "failed") return "تعذر إنشاء رد ناجح";
  return null;
}

export function ChatConsoleV2({ agents, initialConversations, initialConversationId, initialAgentId, initialNewChat, currentUser, initialAppearance, puterEnabled, knowledgeBases, ragEnabled, memoryEnabled }: {
  agents: Agent[];
  initialConversations: Conversation[];
  initialConversationId?: string;
  initialAgentId?: string;
  initialNewChat?: boolean;
  currentUser: { id: string; name: string; email: string };
  initialAppearance: ChatAppearance;
  puterEnabled: boolean;
  knowledgeBases: KnowledgeBaseOption[];
  ragEnabled: boolean;
  memoryEnabled: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState(initialConversations);
  const [conversationId, setConversationId] = useState(
    !initialNewChat && initialConversations.some((item) => item.id === initialConversationId)
      ? initialConversationId ?? ""
      : initialNewChat ? "" : initialConversations[0]?.id ?? "",
  );
  const [agentId, setAgentId] = useState(agents.some((agent) => agent.id === initialAgentId) ? initialAgentId ?? "" : agents[0]?.id ?? "");
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagePage, setMessagePage] = useState(1);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(Boolean(initialConversations.length && !initialNewChat));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loading, setLoading] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryText, setRetryText] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [archivedMode, setArchivedMode] = useState(searchParams.get("view") === "archived");
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [draft, setDraft] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState("auto");
  const [knowledgeBaseId, setKnowledgeBaseId] = useState("");
  const [useMemory, setUseMemory] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [executionMode, setExecutionMode] = useState<"server" | "puter">("server");
  const [puterModels, setPuterModels] = useState<ClientAIModel[]>([]);
  const [puterModel, setPuterModel] = useState("");
  const [puterModelsLoading, setPuterModelsLoading] = useState(false);
  const [puterConnected, setPuterConnected] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [pendingPuterText, setPendingPuterText] = useState<string | null>(null);
  const [appearance, setAppearance] = useState(initialAppearance);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [showLatest, setShowLatest] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [actionDialog, setActionDialog] = useState<ActionDialog | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);

  const streamController = useRef<AbortController | null>(null);
  const puterExecutionRef = useRef<{ executionId: string; userMessageId: string; model: string } | null>(null);
  const uploadRequests = useRef(new Map<string, XMLHttpRequest>());
  const cancelledUploads = useRef(new Set<string>());
  const messagesViewport = useRef<HTMLDivElement | null>(null);
  const scrollAnchor = useRef<HTMLDivElement | null>(null);
  const nearBottom = useRef(true);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const dialogInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const draftReadyRef = useRef(false);

  const conversationGroups = useMemo(() => groupConversations(conversations), [conversations]);
  const activeConversation = useMemo(() => conversations.find((item) => item.id === conversationId), [conversations, conversationId]);
  const selectedModelInfo = useMemo(() => selectedModel === "auto" ? null : models.find((item) => `${item.providerCredentialId}:${item.model}` === selectedModel) ?? null, [models, selectedModel]);
  const modelGroups = useMemo(() => {
    const groups = new Map<string, ModelOption[]>();
    for (const model of models.filter((item) => item.available)) {
      const key = `${model.providerName} · ${model.provider}`;
      groups.set(key, [...(groups.get(key) ?? []), model]);
    }
    return [...groups.entries()];
  }, [models]);
  const readyAttachments = useMemo(() => uploadTasks.filter((task) => uploadReady(task.state) && task.attachment).map((task) => task.attachment!), [uploadTasks]);
  const uploadsBusy = uploadTasks.some((task) => uploadBusy(task.state));
  const closeMembers = useCallback(() => setMembersOpen(false), []);

  const loadMessages = useCallback(async (id: string) => {
    setLoadingMessages(true);
    setMessageError(null);
    try {
      const rows = await apiRequest<Message[]>(`/api/dashboard/chat?conversationId=${encodeURIComponent(id)}&limit=${MESSAGE_PAGE_SIZE}&page=1`);
      setMessages(rows);
      setMessagePage(1);
      setHasOlderMessages(rows.length === MESSAGE_PAGE_SIZE);
      nearBottom.current = true;
      setShowLatest(false);
      window.requestAnimationFrame(() => scrollAnchor.current?.scrollIntoView({ block: "end" }));
    } catch (cause) {
      setMessageError(apiErrorMessage(cause, "تعذر تحميل الرسائل."));
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  async function connectPuter(forceModels = false) {
    if (!puterEnabled) return;
    setPuterModelsLoading(true);
    setComposerError(null);
    try {
      const client = await getPuterClient();
      if (!client.auth.isSignedIn()) await client.auth.signIn();
      const available = await listPuterModels({ force: forceModels, client });
      setPuterModels(available);
      setPuterModel((current) => available.some((item) => item.id === current) ? current : available[0]?.id ?? "");
      setPuterConnected(true);
    } catch (cause) {
      setPuterConnected(false);
      setComposerError(cause instanceof Error ? cause.message : "تعذر الاتصال بـPuter.");
    } finally {
      setPuterModelsLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoadingConversations(true);
      setConversationError(null);
      const query = new URLSearchParams({ limit: String(CONVERSATION_PAGE_SIZE) });
      if (archivedMode) query.set("archived", "true");
      if (search.trim()) query.set("q", search.trim());
      apiRequest<Conversation[]>(`/api/dashboard/chat?${query.toString()}`, { signal: controller.signal })
        .then((rows) => setConversations(rows.map((row) => ({
          ...row,
          updatedAt: new Date(row.updatedAt).toISOString(),
          lastMessageAt: row.lastMessageAt ? new Date(row.lastMessageAt).toISOString() : null,
          pinnedAt: row.pinnedAt ? new Date(row.pinnedAt).toISOString() : null,
          archivedAt: row.archivedAt ? new Date(row.archivedAt).toISOString() : null,
        }))))
        .catch((cause) => { if (!controller.signal.aborted) setConversationError(apiErrorMessage(cause, "تعذر تحميل المحادثات.")); })
        .finally(() => { if (!controller.signal.aborted) setLoadingConversations(false); });
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [archivedMode, search]);

  const refreshModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const available = await apiRequest<ModelOption[]>("/api/dashboard/models");
      setModels(available);
      setSelectedModel((current) => current === "auto" || available.some((item) => `${item.providerCredentialId}:${item.model}` === current) ? current : "auto");
    } catch (cause) {
      setComposerError(apiErrorMessage(cause, "تعذر تحميل النماذج المتاحة."));
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void refreshModels(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [refreshModels]);

  useEffect(() => {
    if (!actionDialog) return;
    const frame = window.requestAnimationFrame(() => dialogInputRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !dialogBusy) setActionDialog(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [actionDialog, dialogBusy]);

  useEffect(() => {
    if (!conversationId) return;
    const timeout = window.setTimeout(() => { void loadMessages(conversationId); }, 0);
    return () => window.clearTimeout(timeout);
  }, [conversationId, loadMessages]);

  useEffect(() => {
    if (!conversationId || activeConversation?.canWrite === false) {
      draftReadyRef.current = false;
      return;
    }
    const controller = new AbortController();
    draftReadyRef.current = false;
    apiRequest<{ content: string; updatedAt: string | null }>(`/api/dashboard/chat/draft?conversationId=${encodeURIComponent(conversationId)}`, { signal: controller.signal })
      .then((stored) => setDraft(stored.content))
      .catch((cause) => { if (!controller.signal.aborted) setComposerError(apiErrorMessage(cause, "تعذر تحميل مسودة المحادثة.")); })
      .finally(() => { if (!controller.signal.aborted) draftReadyRef.current = true; });
    return () => controller.abort();
  }, [conversationId, activeConversation?.canWrite]);

  useEffect(() => {
    if (!conversationId || activeConversation?.canWrite === false || !draftReadyRef.current) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      apiRequest("/api/dashboard/chat/draft", { method: "PUT", signal: controller.signal, body: { conversationId, content: draft } })
        .catch((cause) => { if (!controller.signal.aborted) setComposerError(apiErrorMessage(cause, "تعذر حفظ مسودة المحادثة.")); });
    }, 500);
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [conversationId, draft, activeConversation?.canWrite]);

  useEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${Math.min(Math.max(node.scrollHeight, 48), 160)}px`;
  }, [draft]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (nearBottom.current) {
        scrollAnchor.current?.scrollIntoView({ behavior: messages.length > 2 ? "smooth" : "auto", block: "end" });
        setShowLatest(false);
      } else if (messages.length) {
        setShowLatest(true);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const keyboardOpen = viewport.height < window.innerHeight - 120;
      document.documentElement.dataset.chatKeyboardOpen = keyboardOpen ? "true" : "false";
      document.documentElement.style.setProperty("--chat-visual-height", `${Math.round(viewport.height)}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    return () => {
      viewport.removeEventListener("resize", update);
      delete document.documentElement.dataset.chatKeyboardOpen;
      document.documentElement.style.removeProperty("--chat-visual-height");
    };
  }, []);

  function updateUrl(nextConversationId: string | null, view = archivedMode ? "archived" : "active", newChat = false) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextConversationId) params.set("conversationId", nextConversationId);
    else params.delete("conversationId");
    if (newChat) params.set("new", "true");
    else params.delete("new");
    if (view === "archived") params.set("view", "archived");
    else params.delete("view");
    router.push(`/dashboard/chat${params.size ? `?${params.toString()}` : ""}`, { scroll: false });
  }

  function selectConversation(id: string) {
    if (id === conversationId || loading) {
      setMobileListOpen(false);
      return;
    }
    setMessages([]);
    setRetryText(null);
    setMessageError(null);
    setComposerError(null);
    setNotice(null);
    setUploadTasks([]);
    setConversationId(id);
    setMobileListOpen(false);
    updateUrl(id);
  }

  function startNewConversation() {
    if (loading) return;
    setConversationId("");
    setMessages([]);
    setMessageError(null);
    setComposerError(null);
    setNotice(null);
    setRetryText(null);
    setUploadTasks([]);
    setArchivedMode(false);
    setMobileListOpen(false);
    updateUrl(null, "active", true);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function conversationAction(body: Record<string, unknown>) {
    return apiRequest<Conversation & { deleted?: boolean }>("/api/dashboard/chat", { method: "POST", body });
  }

  async function createConversation() {
    if (!agentId || loading) return null;
    setLoading(true);
    setConversationError(null);
    try {
      const created = await conversationAction({ action: "create", agentId });
      const agentName = agents.find((agent) => agent.id === agentId)?.name ?? "وكيل";
      const row: Conversation = { ...created, agentName, status: "active", pinnedAt: null, archivedAt: null, lastMessageAt: null, canWrite: true, canManage: true, updatedAt: new Date(created.updatedAt).toISOString() };
      setConversations((current) => [row, ...current]);
      setArchivedMode(false);
      setMessages([]);
      setConversationId(row.id);
      setMobileListOpen(false);
      updateUrl(row.id, "active");
      return row;
    } catch (cause) {
      setConversationError(apiErrorMessage(cause, "تعذر إنشاء المحادثة."));
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function renameConversation(row: Conversation, title: string) {
    if (!title.trim()) return false;
    try {
      const updated = await conversationAction({ action: "rename", conversationId: row.id, title: title.trim() });
      setConversations((items) => items.map((item) => item.id === row.id ? { ...item, title: updated.title } : item));
      return true;
    } catch (cause) {
      setConversationError(apiErrorMessage(cause, "تعذر تغيير الاسم."));
      return false;
    }
  }

  async function archiveConversation(row: Conversation) {
    try {
      await conversationAction({ action: "archive", conversationId: row.id, archived: true });
      const remaining = conversations.filter((item) => item.id !== row.id);
      setConversations(remaining);
      if (conversationId === row.id) {
        const next = remaining[0]?.id ?? "";
        setConversationId(next);
        updateUrl(next || null);
      }
    } catch (cause) { setConversationError(apiErrorMessage(cause, "تعذر أرشفة المحادثة.")); }
  }

  async function restoreConversation(row: Conversation) {
    try {
      await conversationAction({ action: "archive", conversationId: row.id, archived: false });
      const remaining = conversations.filter((item) => item.id !== row.id);
      setConversations(remaining);
      if (conversationId === row.id) {
        const next = remaining[0]?.id ?? "";
        setConversationId(next);
        setMessages([]);
        updateUrl(next || null, "archived");
      }
    } catch (cause) { setConversationError(apiErrorMessage(cause, "تعذر استعادة المحادثة.")); }
  }

  async function pinConversation(row: Conversation) {
    try {
      const updated = await conversationAction({ action: "pin", conversationId: row.id, pinned: !row.pinnedAt });
      setConversations((items) => items.map((item) => item.id === row.id ? {
        ...item,
        pinnedAt: updated.pinnedAt ? new Date(updated.pinnedAt).toISOString() : null,
        updatedAt: new Date(updated.updatedAt).toISOString(),
      } : item));
    } catch (cause) { setConversationError(apiErrorMessage(cause, "تعذر تحديث التثبيت.")); }
  }

  async function deleteConversation(row: Conversation) {
    try {
      await conversationAction({ action: "delete", conversationId: row.id });
      const remaining = conversations.filter((item) => item.id !== row.id);
      setConversations(remaining);
      if (conversationId === row.id) {
        const next = remaining[0]?.id ?? "";
        setConversationId(next);
        updateUrl(next || null);
      }
      return true;
    } catch (cause) {
      setConversationError(apiErrorMessage(cause, "تعذر حذف المحادثة."));
      return false;
    }
  }

  function setArchivedView(next: boolean) {
    setArchivedMode(next);
    setConversationId("");
    setMessages([]);
    setMobileListOpen(true);
    updateUrl(null, next ? "archived" : "active");
  }

  async function loadOlderMessages() {
    if (!conversationId || loadingOlder || !hasOlderMessages) return;
    const viewport = messagesViewport.current;
    const previousHeight = viewport?.scrollHeight ?? 0;
    const previousTop = viewport?.scrollTop ?? 0;
    const nextPage = messagePage + 1;
    setLoadingOlder(true);
    setMessageError(null);
    try {
      const older = await apiRequest<Message[]>(`/api/dashboard/chat?conversationId=${encodeURIComponent(conversationId)}&limit=${MESSAGE_PAGE_SIZE}&page=${nextPage}`);
      setMessages((current) => {
        const currentIds = new Set(current.map((item) => item.id));
        return [...older.filter((item) => !currentIds.has(item.id)), ...current];
      });
      setMessagePage(nextPage);
      setHasOlderMessages(older.length === MESSAGE_PAGE_SIZE);
      window.requestAnimationFrame(() => {
        if (viewport) viewport.scrollTop = viewport.scrollHeight - previousHeight + previousTop;
      });
    } catch (cause) {
      setMessageError(apiErrorMessage(cause, "تعذر تحميل الرسائل الأقدم."));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function readEventStream(response: Response, optimisticId: string, activeConversationId: string, pendingAssistantId: string) {
    if (!response.body) throw new Error("لم يبدأ الخادم بث الاستجابة.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assistantId = pendingAssistantId;
    let sawServerMessage = false;
    const applyEvent = (event: string, dataText: string) => {
      if (dataText === "[DONE]") return;
      const data = JSON.parse(dataText) as Record<string, unknown>;
      if (event === "message" && data.userMessage) {
        sawServerMessage = true;
        setMessages((items) => items.map((item) => item.id === optimisticId ? data.userMessage as Message : item));
      } else if (event === "status" && typeof data.message === "string") {
        setNotice(data.message);
      } else if (event === "run" && typeof data.runId === "string") {
        setRunId(data.runId);
        const nextAssistantId = `stream-${data.runId}`;
        setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, id: nextAssistantId, metadata: { ...(item.metadata ?? {}), runId: data.runId } } : item));
        assistantId = nextAssistantId;
      } else if (event === "delta" && typeof data.text === "string") {
        setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, content: item.content + data.text } : item));
      } else if (event === "complete" && typeof data.messageId === "string") {
        const fallbackUsed = data.fallbackUsed === true;
        setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, id: String(data.messageId), status: "completed", metadata: { ...(item.metadata ?? {}), fallbackUsed } } : item));
        setNotice(fallbackUsed ? "استخدم النظام مزوّدًا بديلًا لإكمال الرد وفق سياسة الاستمرارية المفعّلة." : null);
        setRetryText(null);
      } else if (event === "error") {
        setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, status: item.content.trim() ? "interrupted" : "failed", errorCode: typeof data.code === "string" ? data.code : "PROVIDER_REQUEST_FAILED" } : item));
        throw new Error(typeof data.message === "string" ? data.message : "تعذر تشغيل الوكيل.");
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const parsed = splitServerEvents(buffer, done);
      buffer = parsed.remainder;
      for (const item of parsed.events) applyEvent(item.event, item.data);
      if (done) break;
    }
    if (!sawServerMessage) {
      const refreshed = await apiRequest<Message[]>(`/api/dashboard/chat?conversationId=${encodeURIComponent(activeConversationId)}&limit=${MESSAGE_PAGE_SIZE}&page=1`);
      setMessages(refreshed);
      setHasOlderMessages(refreshed.length === MESSAGE_PAGE_SIZE);
      setMessagePage(1);
    }
  }

  function patchUpload(id: string, patch: Partial<UploadTask>) {
    setUploadTasks((tasks) => tasks.map((task) => task.id === id ? { ...task, ...patch } : task));
  }

  function uploadAttachment(taskId: string, file: File) {
    return new Promise<Attachment>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      uploadRequests.current.set(taskId, xhr);
      xhr.open("POST", "/api/dashboard/files");
      xhr.withCredentials = true;
      xhr.timeout = 120_000;
      xhr.setRequestHeader("accept", "application/json");
      xhr.setRequestHeader("x-request-id", crypto.randomUUID());
      xhr.upload.onprogress = (event) => {
        const progress = event.lengthComputable ? Math.min(99, Math.round((event.loaded / event.total) * 100)) : null;
        patchUpload(taskId, { state: "UPLOADING", progress });
      };
      xhr.upload.onload = () => patchUpload(taskId, { state: "PROCESSING", progress: 100 });
      xhr.onload = () => {
        uploadRequests.current.delete(taskId);
        const payload = (() => { try { return JSON.parse(xhr.responseText) as Api<Attachment>; } catch { return null; } })();
        if (xhr.status >= 200 && xhr.status < 300 && payload?.success && payload.data) resolve(payload.data);
        else reject(new Error(payload?.error?.message ?? "تعذر رفع الملف."));
      };
      xhr.onerror = () => { uploadRequests.current.delete(taskId); reject(new Error("تعذر الاتصال بالخادم أثناء رفع الملف.")); };
      xhr.ontimeout = () => { uploadRequests.current.delete(taskId); reject(new Error("انتهت مهلة رفع الملف.")); };
      xhr.onabort = () => { uploadRequests.current.delete(taskId); reject(new DOMException("Upload cancelled", "AbortError")); };
      const form = new FormData();
      form.set("conversationId", conversationId);
      form.set("file", file);
      xhr.send(form);
    });
  }

  async function processUpload(taskId: string, file: File) {
    cancelledUploads.current.delete(taskId);
    patchUpload(taskId, { state: "VALIDATING", progress: 0, message: null, attachment: null });
    const validation = validateClientFile(file);
    if (!validation.valid) {
      patchUpload(taskId, { state: "FAILED", progress: null, message: validation.message });
      return;
    }
    patchUpload(taskId, { state: "UPLOADING", progress: 0 });
    try {
      const attachment = await uploadAttachment(taskId, file);
      const status = attachment.intelligenceStatus ?? attachment.processingStatus ?? "ready";
      if (status === "ready") {
        patchUpload(taskId, { state: "READY", progress: 100, attachment, message: null });
      } else if (status === "partially_ready") {
        patchUpload(taskId, { state: "PARTIALLY_READY", progress: 100, attachment, message: attachment.warnings?.[0] ?? "تمت فهرسة الجزء القابل للمعالجة من الملف." });
      } else {
        patchUpload(taskId, { state: "FAILED", progress: null, attachment, message: attachment.warnings?.[0] ?? "تعذر تحليل الملف." });
      }
    } catch (cause) {
      if (cancelledUploads.current.has(taskId) || cause instanceof DOMException && cause.name === "AbortError") {
        patchUpload(taskId, { state: "CANCELLED", progress: null, message: "أُلغي رفع الملف." });
        return;
      }
      patchUpload(taskId, { state: "FAILED", progress: null, message: cause instanceof Error ? cause.message : "تعذر رفع الملف." });
    }
  }

  function uploadFiles(files: FileList | File[] | null) {
    if (!files || !conversationId || executionMode === "puter") return;
    const available = Math.max(0, MAX_COMPOSER_ATTACHMENTS - uploadTasks.filter((task) => task.state !== "CANCELLED").length);
    const selected = Array.from(files).slice(0, available);
    if (!selected.length) return;
    const tasks = selected.map((file) => ({ id: crypto.randomUUID(), file, state: "SELECTED" as const, progress: 0 }));
    setUploadTasks((current) => [...current, ...tasks]);
    setComposerError(null);
    for (const task of tasks) void processUpload(task.id, task.file);
  }

  function cancelUpload(task: UploadTask) {
    cancelledUploads.current.add(task.id);
    uploadRequests.current.get(task.id)?.abort();
    patchUpload(task.id, { state: "CANCELLED", progress: null, message: "أُلغي رفع الملف." });
  }

  async function removeUpload(task: UploadTask) {
    if (uploadBusy(task.state)) cancelUpload(task);
    if (task.attachment) {
      try {
        await apiRequest("/api/dashboard/files", { method: "DELETE", body: { id: task.attachment.id } });
      } catch (cause) {
        setComposerError(apiErrorMessage(cause, `تعذر إزالة ${task.file.name}.`));
        return;
      }
    }
    setUploadTasks((tasks) => tasks.filter((item) => item.id !== task.id));
  }

  async function retryUpload(task: UploadTask) {
    setComposerError(null);
    if (task.attachment) {
      try {
        await apiRequest("/api/dashboard/files", { method: "DELETE", body: { id: task.attachment.id } });
      } catch (cause) {
        setComposerError(apiErrorMessage(cause, `تعذر تنظيف النسخة السابقة من ${task.file.name}.`));
        return;
      }
    }
    await processUpload(task.id, task.file);
  }

  async function sendServerText(text: string) {
    if (!agentId || activeConversation?.canWrite === false || loading || !text.trim() || uploadsBusy) return;
    const activeId = conversationId || (await createConversation())?.id;
    if (!activeId) return;
    const hasImage = readyAttachments.some((file) => file.mimeType.startsWith("image/"));
    if (hasImage && selectedModelInfo && selectedModelInfo.capabilities?.vision !== true) {
      setComposerError("النموذج المختار لا يعلن دعم الصور. اختر نموذجًا مناسبًا أو استخدم الاختيار التلقائي.");
      return;
    }
    const optimisticId = `local-${crypto.randomUUID()}`;
    const pendingAssistantId = `stream-pending-${crypto.randomUUID()}`;
    setMessages((current) => [...current, {
      id: optimisticId,
      role: "user",
      authorUserId: currentUser.id,
      authorName: currentUser.name,
      authorEmail: currentUser.email,
      content: text.trim(),
      createdAt: new Date().toISOString(),
      attachments: [...readyAttachments],
      status: "sending",
    }, { id: pendingAssistantId, role: "assistant", content: "", status: "streaming", createdAt: new Date().toISOString() }]);
    nearBottom.current = true;
    setLoading(true);
    setComposerError(null);
    setNotice(null);
    setRetryText(null);
    const controller = new AbortController();
    streamController.current = controller;
    let responseStarted = false;
    let responseTimedOut = false;
    const responseTimeout = window.setTimeout(() => {
      if (!responseStarted) {
        responseTimedOut = true;
        controller.abort();
      }
    }, 30_000);
    try {
      const response = await fetch("/api/dashboard/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: activeId,
          message: text.trim(),
          attachmentIds: readyAttachments.map((file) => file.id),
          clientRequestId: crypto.randomUUID(),
          inputKind: readyAttachments.length ? "file" : "text",
          ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
          useMemory: memoryEnabled && useMemory,
          ...(selectedModel === "auto" ? {} : { providerCredentialId: selectedModel.split(":", 1)[0], model: selectedModel.slice(selectedModel.indexOf(":") + 1) }),
        }),
        signal: controller.signal,
      });
      responseStarted = true;
      window.clearTimeout(responseTimeout);
      if (!response.ok) {
        const result = await response.json().catch(() => null) as Api<never> | null;
        throw new Error(result?.error?.message ?? "تعذر تشغيل الوكيل.");
      }
      await readEventStream(response, optimisticId, activeId, pendingAssistantId);
      setUploadTasks([]);
      setDraft("");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setMessages((items) => items.map((item) => item.id === optimisticId && item.status === "sending" ? { ...item, status: "cancelled" } : item.status === "streaming" ? { ...item, status: "cancelled" } : item));
        setComposerError(responseTimedOut ? "لم يبدأ الخادم الاستجابة خلال 30 ثانية. تحقق من المزود ثم أعد المحاولة." : "تم إيقاف التوليد.");
      } else {
        setMessages((items) => items.map((item) => item.id === optimisticId && item.status === "sending" ? { ...item, status: "failed" } : item.status === "streaming" ? { ...item, status: item.content.trim() ? "interrupted" : "failed" } : item));
        setComposerError(cause instanceof Error ? cause.message : "تعذر تشغيل الوكيل.");
        setRetryText(text.trim());
      }
    } finally {
      window.clearTimeout(responseTimeout);
      setLoading(false);
      setRunId(null);
      streamController.current = null;
    }
  }

  async function finishPuterExecution(activeConversationId: string, input: { executionId: string; userMessageId: string; model: string; status: "completed" | "failed" | "cancelled"; content?: string }) {
    const result = await apiRequest<{ assistantMessage: Message | null }>("/api/dashboard/chat/puter", { method: "PATCH", body: { conversationId: activeConversationId, ...input } });
    return result.assistantMessage;
  }

  async function sendPuterText(text: string) {
    if (!agentId || activeConversation?.canWrite === false || loading || !text.trim() || !puterModel || uploadTasks.length) return;
    const activeId = conversationId || (await createConversation())?.id;
    if (!activeId) return;
    const optimisticId = `local-${crypto.randomUUID()}`;
    const assistantId = `stream-puter-${crypto.randomUUID()}`;
    setMessages((current) => [...current, { id: optimisticId, role: "user", authorUserId: currentUser.id, authorName: currentUser.name, authorEmail: currentUser.email, content: text.trim(), status: "sending", createdAt: new Date().toISOString(), attachments: [] }]);
    nearBottom.current = true;
    setLoading(true);
    setComposerError(null);
    setNotice(null);
    setRetryText(null);
    const controller = new AbortController();
    streamController.current = controller;
    try {
      const client = await getPuterClient();
      if (!client.auth.isSignedIn()) throw new Error("اتصل بحساب Puter قبل بدء الدردشة.");
      const result = await apiRequest<{ executionId: string; userMessage: Message; messages: PuterChatMessage[] }>("/api/dashboard/chat/puter", {
        method: "POST",
        body: { conversationId: activeId, message: text.trim(), model: puterModel, clientRequestId: crypto.randomUUID() },
        signal: controller.signal,
      });
      const execution = { executionId: result.executionId, userMessageId: result.userMessage.id, model: puterModel };
      puterExecutionRef.current = execution;
      setMessages((items) => [...items.map((item) => item.id === optimisticId ? { ...result.userMessage, authorName: currentUser.name, authorEmail: currentUser.email } : item), {
        id: assistantId, role: "assistant", content: "", status: "streaming", model: puterModel, createdAt: new Date().toISOString(), metadata: { provider: "puter", executionSource: "client", runId: result.executionId },
      }]);
      const finalText = await streamPuterChat({ client, messages: result.messages, model: puterModel, signal: controller.signal, onText(delta) {
        setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, content: item.content + delta } : item));
      } });
      const saved = await finishPuterExecution(activeId, { ...execution, status: "completed", content: finalText });
      if (saved) setMessages((items) => items.map((item) => item.id === assistantId ? saved : item));
      setRetryText(null);
      setDraft("");
    } catch (cause) {
      const execution = puterExecutionRef.current;
      const cancelled = cause instanceof DOMException && cause.name === "AbortError";
      if (execution) await finishPuterExecution(activeId, { ...execution, status: cancelled ? "cancelled" : "failed" }).catch(() => undefined);
      setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, status: cancelled ? "cancelled" : item.content.trim() ? "interrupted" : "failed" } : item));
      setComposerError(cancelled ? "تم إيقاف استجابة Puter." : cause instanceof Error ? cause.message : "تعذر تشغيل Puter.");
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
    const text = draft.trim();
    if (!text) return;
    await sendText(text);
  }

  async function stop() {
    streamController.current?.abort();
    if (executionMode === "server" && runId) await apiRequest("/api/dashboard/runs", { method: "DELETE", body: { runId } }).catch(() => undefined);
  }

  async function mutateMessage(message: Message, action: "edit" | "delete", nextContent?: string) {
    const content = action === "edit" ? nextContent?.trim() : undefined;
    if (action === "edit" && !content) return false;
    try {
      await apiRequest<Message>("/api/dashboard/messages", { method: "PATCH", body: { action, messageId: message.id, ...(content ? { content } : {}) } });
      if (action === "delete") setMessages((items) => items.filter((item) => item.id !== message.id));
      else {
        setMessages((items) => items.map((item) => item.id === message.id ? { ...item, content: content ?? item.content, editedAt: new Date().toISOString() } : item));
        await sendText(content!);
      }
      return true;
    } catch (cause) {
      setMessageError(apiErrorMessage(cause, "تعذر تحديث الرسالة."));
      return false;
    }
  }

  async function saveAppearance(next: ChatAppearance) {
    const previous = appearance;
    setAppearance(next);
    setSavingAppearance(true);
    setComposerError(null);
    try {
      setAppearance(await apiRequest<ChatAppearance>("/api/dashboard/chat/preferences", { method: "PUT", body: next }));
    } catch (cause) {
      setAppearance(previous);
      setComposerError(apiErrorMessage(cause, "تعذر حفظ مظهر المحادثة."));
    } finally { setSavingAppearance(false); }
  }

  function selectTheme(theme: ChatThemeId) { if (theme !== appearance.theme) void saveAppearance({ ...appearance, theme }); }
  function selectWallpaper(wallpaper: ChatWallpaperId) { if (wallpaper !== appearance.wallpaper) void saveAppearance({ ...appearance, wallpaper }); }

  function handleMessageScroll() {
    const viewport = messagesViewport.current;
    if (!viewport) return;
    nearBottom.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 140;
    setShowLatest(!nearBottom.current);
  }

  function scrollToLatest() {
    nearBottom.current = true;
    setShowLatest(false);
    scrollAnchor.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  async function copyMessage(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1_500);
    } catch {
      setMessageError("تعذر نسخ الرسالة. اسمح للمتصفح بالوصول إلى الحافظة ثم حاول مجددًا.");
    }
  }

  async function submitActionDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actionDialog || dialogBusy) return;
    setDialogBusy(true);
    try {
      let succeeded = false;
      if (actionDialog.kind === "rename-conversation") succeeded = await renameConversation(actionDialog.row, actionDialog.value);
      if (actionDialog.kind === "delete-conversation") succeeded = await deleteConversation(actionDialog.row);
      if (actionDialog.kind === "edit-message") succeeded = await mutateMessage(actionDialog.message, "edit", actionDialog.value);
      if (actionDialog.kind === "delete-message") succeeded = await mutateMessage(actionDialog.message, "delete");
      if (succeeded) setActionDialog(null);
    } finally {
      setDialogBusy(false);
    }
  }

  const sendDisabled = !agents.length || activeConversation?.canWrite === false || !draft.trim() || uploadsBusy || loading
    || executionMode === "puter" && (!puterModel || !puterConnected || uploadTasks.length > 0);

  return (
    <div className="conversation-workspace" data-mobile-list-open={mobileListOpen ? "true" : "false"}>
      <aside className="conversation-sidebar" aria-label="قائمة المحادثات">
        <header className="conversation-sidebar-header">
          <div><p className="eyebrow">مساحة العمل</p><h2>المحادثات</h2></div>
          <button type="button" className="icon-button" aria-label="محادثة جديدة" disabled={loading || !agents.length} onClick={startNewConversation}><FilePlus2 size={19} /></button>
        </header>
        <div className="conversation-sidebar-controls">
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="form-control" placeholder="ابحث في المحادثات…" aria-label="بحث في المحادثات" />
          <div className="conversation-new-row">
            <select value={agentId} onChange={(event) => setAgentId(event.target.value)} className="form-control" aria-label="وكيل المحادثة الجديدة">
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <button type="button" className="primary-button" disabled={loading || !agents.length} onClick={startNewConversation}>جديدة</button>
          </div>
          <div className="segmented-control" aria-label="عرض المحادثات">
            <button type="button" aria-pressed={!archivedMode} onClick={() => setArchivedView(false)}>النشطة</button>
            <button type="button" aria-pressed={archivedMode} onClick={() => setArchivedView(true)}>المؤرشفة</button>
          </div>
        </div>
        {conversationError ? <div className="compact-error" role="alert"><span>{conversationError}</span></div> : null}
        <div className="conversation-list" aria-busy={loadingConversations}>
          {loadingConversations && !conversations.length ? <>{[0, 1, 2, 3].map((item) => <div key={item} className="skeleton conversation-row-skeleton" />)}</> : null}
          {conversationGroups.map((group) => (
            <section key={group.key} className="conversation-group">
              <h3>{group.label}</h3>
              {group.items.map((row) => (
                <article key={row.id} className={`conversation-list-item${row.id === conversationId ? " is-active" : ""}`}>
                  <button type="button" className="conversation-list-main" onClick={() => selectConversation(row.id)}>
                    <span className="conversation-avatar" aria-hidden="true">{row.agentName.slice(0, 1)}</span>
                    <span className="conversation-list-copy">
                      <b>{row.title?.trim() || "محادثة بدون عنوان"}{row.pinnedAt ? <Pin size={12} aria-label="مثبتة" /> : null}</b>
                      <small>{row.summary?.trim() || row.agentName}</small>
                    </span>
                    <time>{relativeTime(row.lastMessageAt ?? row.updatedAt)}</time>
                  </button>
                  {row.canManage !== false ? (
                    <details className="entity-menu">
                      <summary aria-label={`إجراءات ${row.title || "المحادثة"}`}><MoreHorizontal size={18} /></summary>
                      <div>
                        <button type="button" onClick={() => selectConversation(row.id)}>فتح</button>
                        <button type="button" onClick={() => setActionDialog({ kind: "rename-conversation", row, value: row.title ?? "" })}><Pencil size={14} /> إعادة تسمية</button>
                        {!archivedMode ? <button type="button" onClick={() => void pinConversation(row)}><Pin size={14} /> {row.pinnedAt ? "إلغاء التثبيت" : "تثبيت"}</button> : null}
                        {archivedMode ? <button type="button" onClick={() => void restoreConversation(row)}><RotateCcw size={14} /> استعادة</button> : <button type="button" onClick={() => void archiveConversation(row)}><Archive size={14} /> أرشفة</button>}
                        <button type="button" className="danger-menu-action" onClick={() => setActionDialog({ kind: "delete-conversation", row })}><Trash2 size={14} /> حذف</button>
                      </div>
                    </details>
                  ) : null}
                </article>
              ))}
            </section>
          ))}
          {!loadingConversations && !conversationError && conversations.length === 0 ? <div className="conversation-empty"><p>{archivedMode ? "لا توجد محادثات مؤرشفة." : "ابدأ محادثة جديدة مع أحد الوكلاء المنشورين."}</p>{!archivedMode && agents.length ? <button type="button" className="primary-button" onClick={startNewConversation}>محادثة جديدة</button> : null}</div> : null}
        </div>
      </aside>

      <section className="conversation-main">
        <header className="conversation-header">
          <div className="conversation-header-title">
            <button type="button" className="icon-button chat-mobile-list-button" onClick={() => setMobileListOpen(true)} aria-label="العودة إلى المحادثات"><ArrowRight size={19} /></button>
            <span className="conversation-agent-avatar" aria-hidden="true">{activeConversation?.agentName?.slice(0, 1) ?? "AI"}</span>
            <div className="min-w-0"><h2>{activeConversation?.title?.trim() || "محادثة جديدة"}</h2><p>{activeConversation?.agentName ?? agents.find((agent) => agent.id === agentId)?.name ?? "يلزم نشر وكيل للبدء"}</p></div>
          </div>
          <div className="conversation-header-actions">
            <button type="button" className="icon-button" disabled={!conversationId} onClick={() => setMembersOpen(true)} aria-label="أعضاء المحادثة"><Users size={18} /></button>
            <button type="button" className="icon-button" onClick={() => setAppearanceOpen(true)} aria-label="مظهر المحادثة"><Palette size={18} /></button>
          </div>
        </header>

        <div ref={messagesViewport} className={`chat-stage chat-theme-${appearance.theme} chat-wallpaper-${appearance.wallpaper}`} aria-live="polite" onScroll={handleMessageScroll}>
          {hasOlderMessages ? <div className="older-messages"><button type="button" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>{loadingOlder ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} رسائل أقدم</button></div> : null}
          {messageError ? <div className="message-error" role="alert"><p>{messageError}</p>{conversationId ? <button type="button" className="secondary-button" onClick={() => void loadMessages(conversationId)}>إعادة المحاولة</button> : null}</div> : null}
          {loadingMessages ? <div className="message-skeleton-stack">{[0, 1, 2].map((item) => <div key={item} className="skeleton message-skeleton" />)}</div> : null}
          {!loadingMessages && !messageError && conversationId && messages.length === 0 ? <div className="message-empty"><span>✦</span><h3>ابدأ المحادثة</h3><p>اكتب رسالتك، ويمكنك إضافة ملفات أو سياق متقدم عند الحاجة.</p></div> : null}
          {!conversationId ? <div className="message-empty new-chat-empty"><span>✦</span><h3>ابدأ مع وكيلك الذكي</h3><p>{agents.length ? "اختر الوكيل والنموذج، ثم اكتب رسالتك. سننشئ المحادثة تلقائيًا عند الإرسال." : "لا يوجد وكيل منشور. أنشئ وكيلًا واربطه بمزوّد متحقق أولًا."}</p>{agents.length ? <label><span>الوكيل</span><select className="form-control" value={agentId} onChange={(event) => setAgentId(event.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label> : <a className="primary-button" href="/dashboard/agents">إعداد وكيل ذكي</a>}</div> : null}
          {messages.map((message) => {
            const statusLabel = messageStatusLabel(message.status);
            const canMutate = (message.authorUserId === currentUser.id || activeConversation?.canManage) && !message.id.startsWith("stream-") && !message.id.startsWith("local-");
            return (
              <article key={message.id} className={`chat-message ${message.role === "user" ? "chat-message-user" : "chat-message-assistant"}`}>
                <div className="message-author"><span>{message.role === "assistant" ? activeConversation?.agentName ?? "الوكيل" : message.authorUserId === currentUser.id ? "أنت" : message.authorName || message.authorEmail || "عضو"}</span>{message.role === "assistant" ? <span aria-hidden="true">✦</span> : null}</div>
                <MessageContent content={message.content} pending={message.status === "streaming" || message.status === "sending"} />
                {statusLabel ? <p className={`message-status message-status-${message.status}`} role={message.status === "failed" || message.status === "interrupted" ? "alert" : "status"}>{message.status === "streaming" ? <Loader2 size={13} className="animate-spin" /> : null}{statusLabel}</p> : null}
                {message.attachments?.length ? <div className="message-attachments">{message.attachments.map((file) => <a key={file.id} href={`/api/dashboard/files?id=${encodeURIComponent(file.id)}`}><FileText size={14} /><span>{file.filename}</span><small>{file.processingStatus === "ready" ? "جاهز" : "ملف"}</small></a>)}</div> : null}
                <footer className="message-footer">
                  <time>{new Date(message.createdAt).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}</time>
                  {message.content ? <button type="button" onClick={() => void copyMessage(message)} aria-label={copiedMessageId === message.id ? "تم نسخ الرسالة" : "نسخ الرسالة"}>{copiedMessageId === message.id ? <Check size={13} /> : <Copy size={13} />} {copiedMessageId === message.id ? "تم النسخ" : "نسخ"}</button> : null}
                  {canMutate || message.role === "user" && !message.id.startsWith("local-") ? <details className="message-actions-menu"><summary aria-label="إجراءات الرسالة"><MoreHorizontal size={16} /></summary><div>{message.role === "user" && canMutate ? <button type="button" onClick={() => setActionDialog({ kind: "edit-message", message, value: message.content })}><Pencil size={13} /> تعديل وإعادة توليد</button> : null}{canMutate ? <button type="button" className="danger-menu-action" onClick={() => setActionDialog({ kind: "delete-message", message })}><Trash2 size={13} /> حذف</button> : null}</div></details> : null}
                </footer>
                <TechnicalDetails
                  model={message.model}
                  provider={metadataString(message, "provider")}
                  latencyMs={message.latencyMs}
                  inputTokens={message.inputTokens}
                  outputTokens={message.outputTokens}
                  runId={metadataString(message, "runId")}
                  errorCode={message.errorCode}
                  toolCalls={toolCallCount(message)}
                />
              </article>
            );
          })}
          <div ref={scrollAnchor} />
        </div>

        {showLatest ? <button type="button" className="latest-message-button" onClick={scrollToLatest}><ArrowDown size={16} /> أحدث رسالة</button> : null}

        <form onSubmit={send} className="chat-composer">
          <textarea
            ref={composerRef}
            name="message"
            maxLength={30000}
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={!agents.length || activeConversation?.canWrite === false || loading}
            placeholder={activeConversation?.canWrite === false ? "هذه المحادثة للقراءة فقط" : conversationId ? "اكتب رسالة…" : "اكتب أول رسالة لبدء المحادثة…"}
            aria-label="رسالة المحادثة"
          />

          {uploadTasks.length ? <div className="composer-attachments" aria-label="المرفقات">{uploadTasks.map((task) => (
            <div key={task.id} className={`attachment-item attachment-state-${task.state.toLowerCase()}`}>
                <FileText size={18} aria-hidden="true" />
              <div className="attachment-item-copy"><b>{task.file.name}</b><span>{humanFileSize(task.file.size)} · {uploadLabels[task.state]}</span>{task.message ? <small>{task.message}</small> : null}{task.state === "UPLOADING" && task.progress !== null ? <progress max="100" value={task.progress}>{task.progress}%</progress> : null}{task.state === "PROCESSING" ? <span className="attachment-processing"><Loader2 size={12} className="animate-spin" /> جارٍ تحليل الملف…</span> : null}{task.attachment?.chunkCount ? <small>{new Intl.NumberFormat("ar").format(task.attachment.chunkCount)} جزءًا مفهرسًا</small> : null}</div>
              <div className="attachment-item-actions">{uploadBusy(task.state) ? <button type="button" aria-label={`إلغاء ${task.file.name}`} onClick={() => cancelUpload(task)}><X size={16} /></button> : null}{task.state === "FAILED" || task.state === "CANCELLED" ? <button type="button" aria-label={`إعادة محاولة ${task.file.name}`} onClick={() => void retryUpload(task)}><RefreshCw size={15} /></button> : null}<button type="button" aria-label={`إزالة ${task.file.name}`} onClick={() => void removeUpload(task)}><Trash2 size={15} /></button></div>
            </div>
          ))}</div> : null}

          {toolsOpen ? <section className="composer-tools-panel" aria-label="أدوات وسياق المحادثة">
            {puterEnabled ? <label><span>مصدر التنفيذ</span><select value={executionMode} onChange={(event) => {
              const next = event.target.value === "puter" ? "puter" : "server";
              if (next === "puter" && uploadTasks.length) { setComposerError("أزل المرفقات قبل التحويل إلى Puter؛ هذا المسار لا يرسل الملفات."); return; }
              setExecutionMode(next);
              if (next === "puter" && !puterModels.length) void connectPuter();
            }}><option value="server">الوكيل على الخادم</option><option value="puter" disabled={uploadTasks.length > 0}>Puter من المتصفح</option></select></label> : null}
            {executionMode === "server" && ragEnabled ? <label><span>قاعدة المعرفة</span><select value={knowledgeBaseId} onChange={(event) => setKnowledgeBaseId(event.target.value)}><option value="">بدون قاعدة معرفة</option>{knowledgeBases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label> : null}
            {executionMode === "server" && memoryEnabled ? <label className="composer-checkbox"><input type="checkbox" checked={useMemory} onChange={(event) => setUseMemory(event.target.checked)} /><span><b>ذاكرة الوكيل</b><small>استخدم الذاكرة المسموح بها لهذا الحساب فقط.</small></span></label> : null}
            {executionMode === "puter" ? <div className="puter-tools"><label><span>نموذج Puter</span><select value={puterModel} onChange={(event) => setPuterModel(event.target.value)} disabled={puterModelsLoading}><option value="">اختر نموذجًا</option>{puterModels.map((model) => <option key={model.id} value={model.id}>{model.name} — {model.provider}</option>)}</select></label><button type="button" className="secondary-button" disabled={puterModelsLoading} onClick={() => void connectPuter(true)}>{puterModelsLoading ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />} {puterConnected ? "تحديث الاتصال" : "الاتصال بـPuter"}</button></div> : null}
            {selectedModelInfo && executionMode === "server" ? <div className="model-capabilities"><b>{friendlyModelName(selectedModelInfo.model)}</b><span className="technical-value">{selectedModelInfo.provider} / {selectedModelInfo.model}</span><small>{selectedModelInfo.capabilities?.vision ? "صور · " : ""}{selectedModelInfo.capabilities?.files ? "ملفات · " : ""}{selectedModelInfo.capabilities?.tools ? "أدوات" : ""}</small></div> : null}
          </section> : null}

          {composerError ? <div className="composer-feedback composer-feedback-error" role="alert">{composerError}</div> : null}
          {notice ? <div className="composer-feedback" role="status">{notice}</div> : null}
          {retryText && !loading ? <button type="button" className="composer-retry" onClick={() => void sendText(retryText)}><RefreshCw size={13} /> إعادة المحاولة</button> : null}

          <div className="composer-toolbar">
            <div className="composer-toolbar-start">
              <label className={`composer-icon-action${executionMode === "puter" ? " is-disabled" : ""}`} aria-label="إرفاق ملف">
                <FilePlus2 size={18} aria-hidden="true" />
                <span>ملف</span>
                <input type="file" multiple className="sr-only" disabled={!conversationId || activeConversation?.canWrite === false || loading || executionMode === "puter" || uploadTasks.length >= MAX_COMPOSER_ATTACHMENTS} accept={acceptedFileInput} onChange={(event) => { uploadFiles(event.target.files); event.target.value = ""; }} />
              </label>
              {executionMode === "server" ? <select className="composer-model-select" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} aria-label="النموذج" disabled={modelsLoading}><option value="auto">{modelsLoading ? "جارٍ تحميل النماذج…" : "النموذج: تلقائي"}</option>{modelGroups.map(([provider, items]) => <optgroup key={provider} label={provider}>{items.map((item) => <option key={`${item.providerCredentialId}:${item.model}`} value={`${item.providerCredentialId}:${item.model}`}>{friendlyModelName(item.model)}{item.freeTierEligible ? " · مجاني" : ""}</option>)}</optgroup>)}</select> : <span className="composer-model-label">{puterModel ? friendlyModelName(puterModel) : "Puter"}</span>}
              {executionMode === "server" && !modelsLoading && models.length === 0 ? <button type="button" className="composer-icon-action" onClick={() => void refreshModels()} aria-label="إعادة تحميل النماذج"><RefreshCw size={16} /><span>تحديث النماذج</span></button> : null}
              <button type="button" className={toolsOpen ? "composer-icon-action is-active" : "composer-icon-action"} onClick={() => setToolsOpen((value) => !value)} aria-expanded={toolsOpen}><Wrench size={17} /><span>أدوات</span></button>
            </div>
            {loading ? <button type="button" onClick={() => void stop()} className="composer-send composer-stop" aria-label="إيقاف التوليد"><Square size={17} fill="currentColor" /><span>إيقاف</span></button> : <button type="submit" disabled={sendDisabled} className="composer-send" aria-label="إرسال الرسالة"><Send size={18} /><span>إرسال</span></button>}
          </div>
        </form>
      </section>

      {conversationId ? <ConversationMembersPanel conversationId={conversationId} open={membersOpen} onClose={closeMembers} /> : null}

      {appearanceOpen ? <div className="mobile-sheet-overlay" role="presentation" onMouseDown={() => setAppearanceOpen(false)}><section className="mobile-sheet appearance-sheet" role="dialog" aria-modal="true" aria-label="مظهر المحادثة" onMouseDown={(event) => event.stopPropagation()}><div className="mobile-sheet-handle" /><header className="mobile-sheet-header"><div><h2>مظهر المحادثة</h2><p>يُحفظ اختيارك في حسابك على الخادم.</p></div><button type="button" className="icon-button" onClick={() => setAppearanceOpen(false)} aria-label="إغلاق"><X size={18} /></button></header><div className="appearance-sheet-grid"><div><h3>الثيم</h3>{chatThemeOptions.map((option) => <button key={option.id} type="button" disabled={savingAppearance} className={appearance.theme === option.id ? "is-selected" : ""} onClick={() => selectTheme(option.id)}><span><b>{option.label}</b><small>{option.description}</small></span>{appearance.theme === option.id ? <Check size={15} /> : null}</button>)}</div><div><h3>الخلفية</h3>{chatWallpaperOptions.map((option) => <button key={option.id} type="button" disabled={savingAppearance} className={appearance.wallpaper === option.id ? "is-selected" : ""} onClick={() => selectWallpaper(option.id)}><span><b>{option.label}</b><small>{option.description}</small></span>{appearance.wallpaper === option.id ? <Check size={15} /> : null}</button>)}</div></div></section></div> : null}

      {privacyOpen ? <div className="mobile-sheet-overlay" role="presentation" onMouseDown={() => setPrivacyOpen(false)}><section className="mobile-sheet" role="dialog" aria-modal="true" aria-labelledby="puter-privacy-title" onMouseDown={(event) => event.stopPropagation()}><div className="mobile-sheet-handle" /><header className="mobile-sheet-header"><div><h2 id="puter-privacy-title">قبل استخدام Puter</h2><p>سيُرسل سياق المحادثة الضروري إلى Puter ومزوّد النموذج. لا ترسل أسرارًا أو مفاتيح API.</p></div></header><div className="sheet-actions"><button type="button" className="secondary-button" onClick={() => { setPrivacyOpen(false); setPendingPuterText(null); }}>إلغاء</button><button type="button" className="primary-button" onClick={() => { localStorage.setItem("moataz:puter:privacy-consent", "accepted"); const pending = pendingPuterText; setPrivacyOpen(false); setPendingPuterText(null); if (pending) void sendPuterText(pending); }}>أفهم وأتابع</button></div></section></div> : null}

      {actionDialog ? (
        <div className="chat-dialog-overlay" role="presentation" onMouseDown={() => { if (!dialogBusy) setActionDialog(null); }}>
          <form className="chat-action-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-action-dialog-title" onSubmit={submitActionDialog} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2 id="chat-action-dialog-title">{actionDialog.kind === "rename-conversation" ? "إعادة تسمية المحادثة" : actionDialog.kind === "edit-message" ? "تعديل الرسالة" : actionDialog.kind === "delete-conversation" ? "نقل المحادثة إلى المحذوفات" : "حذف الرسالة"}</h2>
                <p>{actionDialog.kind === "edit-message" ? "سيُحفظ التعديل ثم يُنشأ رد جديد بالرسالة المعدلة." : actionDialog.kind === "delete-conversation" ? "ستختفي المحادثة من مساحة العمل وفق سياسة الاحتفاظ." : actionDialog.kind === "delete-message" ? "سيُحذف محتوى الرسالة من هذه المحادثة." : "اختر عنوانًا واضحًا يسهل العثور عليه لاحقًا."}</p>
              </div>
              <button type="button" className="icon-button" disabled={dialogBusy} onClick={() => setActionDialog(null)} aria-label="إغلاق"><X size={18} /></button>
            </header>
            {actionDialog.kind === "rename-conversation" ? <input ref={(node) => { dialogInputRef.current = node; }} className="form-control" maxLength={140} required value={actionDialog.value} onChange={(event) => setActionDialog({ ...actionDialog, value: event.target.value })} aria-label="عنوان المحادثة" /> : null}
            {actionDialog.kind === "edit-message" ? <textarea ref={(node) => { dialogInputRef.current = node; }} className="form-control" maxLength={30000} required rows={6} value={actionDialog.value} onChange={(event) => setActionDialog({ ...actionDialog, value: event.target.value })} aria-label="محتوى الرسالة" /> : null}
            <div className="sheet-actions">
              <button type="button" className="secondary-button" disabled={dialogBusy} onClick={() => setActionDialog(null)}>إلغاء</button>
              <button type="submit" className={actionDialog.kind.startsWith("delete") ? "danger-button" : "primary-button"} disabled={dialogBusy || "value" in actionDialog && !actionDialog.value.trim()}>{dialogBusy ? <Loader2 size={15} className="animate-spin" /> : null}{actionDialog.kind === "rename-conversation" ? "حفظ العنوان" : actionDialog.kind === "edit-message" ? "حفظ وإعادة التوليد" : "تأكيد الحذف"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
