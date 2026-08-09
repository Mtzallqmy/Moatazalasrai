"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorMessage, apiRequest } from "@/lib/http/client";

const SAVE_DELAY_MS = 1_200;
const LOCAL_SAVE_DELAY_MS = 250;

function storageKey(conversationId: string) {
  return `moataz:chat:draft:${conversationId}`;
}

function readLocalDraft(conversationId: string) {
  try { return window.localStorage.getItem(storageKey(conversationId)) ?? ""; }
  catch { return ""; }
}

function persistLocalDraft(conversationId: string, value: string) {
  if (!conversationId) return;
  try {
    if (value) window.localStorage.setItem(storageKey(conversationId), value);
    else window.localStorage.removeItem(storageKey(conversationId));
  } catch {
    // Local storage may be unavailable in hardened/private browser contexts.
  }
}

export function useDraft(conversationId: string, canWrite: boolean, onError: (message: string) => void) {
  const [draft, setDraftState] = useState("");
  const [readyVersion, setReadyVersion] = useState(0);
  const versionRef = useRef(0);
  const dirtyRef = useRef(false);
  const draftRef = useRef("");
  const localSaveRef = useRef<number | null>(null);
  const loadRef = useRef<AbortController | null>(null);
  const saveRef = useRef<AbortController | null>(null);

  const cancelLocalSave = useCallback(() => {
    if (localSaveRef.current !== null) window.clearTimeout(localSaveRef.current);
    localSaveRef.current = null;
  }, []);

  useEffect(() => {
    const version = ++versionRef.current;
    loadRef.current?.abort();
    saveRef.current?.abort();
    cancelLocalSave();
    dirtyRef.current = false;
    draftRef.current = "";
    if (!conversationId || !canWrite) {
      queueMicrotask(() => {
        setDraftState("");
        setReadyVersion(0);
      });
      return;
    }
    const local = readLocalDraft(conversationId);
    draftRef.current = local;
    queueMicrotask(() => setDraftState(local));
    const controller = new AbortController();
    loadRef.current = controller;
    apiRequest<{ content: string }>(`/api/dashboard/chat/draft?conversationId=${encodeURIComponent(conversationId)}`, { signal: controller.signal })
      .then((stored) => {
        if (controller.signal.aborted || version !== versionRef.current) return;
        setDraftState((current) => {
          if (current || dirtyRef.current) return current;
          draftRef.current = stored.content;
          return stored.content;
        });
      })
      .catch((cause) => {
        if (!controller.signal.aborted && version === versionRef.current) onError(apiErrorMessage(cause, "تعذر تحميل مسودة المحادثة."));
      })
      .finally(() => {
        if (!controller.signal.aborted && version === versionRef.current) setReadyVersion(version);
      });
    return () => {
      if (dirtyRef.current) persistLocalDraft(conversationId, draftRef.current);
      cancelLocalSave();
      loadRef.current?.abort();
      saveRef.current?.abort();
    };
  }, [canWrite, cancelLocalSave, conversationId, onError]);

  const setDraft = useCallback((value: string) => {
    dirtyRef.current = true;
    draftRef.current = value;
    setDraftState(value);
    if (!conversationId) return;
    cancelLocalSave();
    localSaveRef.current = window.setTimeout(() => {
      localSaveRef.current = null;
      persistLocalDraft(conversationId, draftRef.current);
    }, LOCAL_SAVE_DELAY_MS);
  }, [cancelLocalSave, conversationId]);

  useEffect(() => {
    if (!conversationId || !canWrite || !dirtyRef.current || readyVersion !== versionRef.current) return;
    const version = versionRef.current;
    const timeout = window.setTimeout(() => {
      saveRef.current?.abort();
      const controller = new AbortController();
      saveRef.current = controller;
      apiRequest("/api/dashboard/chat/draft", {
        method: "PUT",
        signal: controller.signal,
        body: { conversationId, content: draft },
      }).then(() => {
        if (!controller.signal.aborted && version === versionRef.current) dirtyRef.current = false;
      }).catch((cause) => {
        if (!controller.signal.aborted && version === versionRef.current) onError(apiErrorMessage(cause, "تعذر مزامنة المسودة."));
      });
    }, SAVE_DELAY_MS);
    return () => {
      window.clearTimeout(timeout);
      saveRef.current?.abort();
    };
  }, [canWrite, conversationId, draft, onError, readyVersion]);

  const clear = useCallback(() => {
    cancelLocalSave();
    dirtyRef.current = true;
    draftRef.current = "";
    setDraftState("");
    persistLocalDraft(conversationId, "");
  }, [cancelLocalSave, conversationId]);

  return { draft, setDraft, clear };
}
