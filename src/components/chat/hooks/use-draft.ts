"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorMessage, apiRequest } from "@/lib/http/client";

const SAVE_DELAY_MS = 1_200;

function storageKey(conversationId: string) {
  return `moataz:chat:draft:${conversationId}`;
}

export function useDraft(conversationId: string, canWrite: boolean, onError: (message: string) => void) {
  const [draft, setDraftState] = useState("");
  const [readyVersion, setReadyVersion] = useState(0);
  const versionRef = useRef(0);
  const dirtyRef = useRef(false);
  const loadRef = useRef<AbortController | null>(null);
  const saveRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const version = ++versionRef.current;
    loadRef.current?.abort();
    saveRef.current?.abort();
    dirtyRef.current = false;
    if (!conversationId || !canWrite) {
      queueMicrotask(() => {
        setDraftState("");
        setReadyVersion(0);
      });
      return;
    }
    const local = window.localStorage.getItem(storageKey(conversationId)) ?? "";
    queueMicrotask(() => setDraftState(local));
    const controller = new AbortController();
    loadRef.current = controller;
    apiRequest<{ content: string }>(`/api/dashboard/chat/draft?conversationId=${encodeURIComponent(conversationId)}`, { signal: controller.signal })
      .then((stored) => {
        if (controller.signal.aborted || version !== versionRef.current) return;
        setDraftState((current) => current || stored.content);
      })
      .catch((cause) => {
        if (!controller.signal.aborted && version === versionRef.current) onError(apiErrorMessage(cause, "تعذر تحميل مسودة المحادثة."));
      })
      .finally(() => {
        if (!controller.signal.aborted && version === versionRef.current) setReadyVersion(version);
      });
    return () => {
      loadRef.current?.abort();
      saveRef.current?.abort();
    };
  }, [canWrite, conversationId, onError]);

  const setDraft = useCallback((value: string) => {
    dirtyRef.current = true;
    setDraftState(value);
    if (conversationId) window.localStorage.setItem(storageKey(conversationId), value);
  }, [conversationId]);

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
    dirtyRef.current = true;
    setDraftState("");
    if (conversationId) window.localStorage.removeItem(storageKey(conversationId));
  }, [conversationId]);

  return { draft, setDraft, clear };
}
