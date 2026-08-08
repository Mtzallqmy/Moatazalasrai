"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorMessage, apiRequest } from "@/lib/http/client";
import type { Message } from "../types";

export const MESSAGE_PAGE_SIZE = 40;

export function useConversationMessages(conversationId: string, skipLoadForId?: string) {
  const [completedMessages, setCompletedMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(Boolean(conversationId));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef(1);
  const generationRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const olderControllerRef = useRef<AbortController | null>(null);

  const replaceAll = useCallback((messages: Message[]) => {
    setCompletedMessages(messages);
    pageRef.current = 1;
    setHasOlder(messages.length === MESSAGE_PAGE_SIZE);
  }, []);

  const load = useCallback(async (id: string) => {
    const generation = ++generationRef.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const rows = await apiRequest<Message[]>(`/api/dashboard/chat?conversationId=${encodeURIComponent(id)}&limit=${MESSAGE_PAGE_SIZE}&page=1`, { signal: controller.signal });
      if (controller.signal.aborted || generation !== generationRef.current) return;
      replaceAll(rows);
    } catch (cause) {
      if (!controller.signal.aborted && generation === generationRef.current) setError(apiErrorMessage(cause, "تعذر تحميل الرسائل."));
    } finally {
      if (!controller.signal.aborted && generation === generationRef.current) setLoading(false);
    }
  }, [replaceAll]);

  useEffect(() => {
    generationRef.current += 1;
    loadControllerRef.current?.abort();
    olderControllerRef.current?.abort();
    pageRef.current = 1;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setCompletedMessages([]);
      setLoadingOlder(false);
      setHasOlder(false);
      setError(null);
      setLoading(Boolean(conversationId && conversationId !== skipLoadForId));
    });
    if (!conversationId || conversationId === skipLoadForId) {
      return () => { active = false; };
    }
    queueMicrotask(() => { if (active) void load(conversationId); });
    return () => {
      active = false;
      generationRef.current += 1;
      loadControllerRef.current?.abort();
      olderControllerRef.current?.abort();
    };
  }, [conversationId, load, skipLoadForId]);

  const loadOlder = useCallback(async () => {
    if (!conversationId || loadingOlder || !hasOlder) return 0;
    olderControllerRef.current?.abort();
    const controller = new AbortController();
    olderControllerRef.current = controller;
    const generation = generationRef.current;
    const nextPage = pageRef.current + 1;
    setLoadingOlder(true);
    setError(null);
    try {
      const older = await apiRequest<Message[]>(`/api/dashboard/chat?conversationId=${encodeURIComponent(conversationId)}&limit=${MESSAGE_PAGE_SIZE}&page=${nextPage}`, { signal: controller.signal });
      if (controller.signal.aborted || generation !== generationRef.current) return 0;
      setCompletedMessages((current) => {
        const ids = new Set(current.map((item) => item.id));
        return [...older.filter((item) => !ids.has(item.id)), ...current];
      });
      pageRef.current = nextPage;
      setHasOlder(older.length === MESSAGE_PAGE_SIZE);
      return older.length;
    } catch (cause) {
      if (!controller.signal.aborted && generation === generationRef.current) setError(apiErrorMessage(cause, "تعذر تحميل الرسائل الأقدم."));
      return 0;
    } finally {
      if (!controller.signal.aborted && generation === generationRef.current) setLoadingOlder(false);
    }
  }, [conversationId, hasOlder, loadingOlder]);

  const append = useCallback((message: Message) => setCompletedMessages((current) => [...current, message]), []);
  const replace = useCallback((id: string, message: Message) => setCompletedMessages((current) => current.map((item) => item.id === id ? message : item)), []);
  const patch = useCallback((id: string, value: Partial<Message>) => setCompletedMessages((current) => current.map((item) => item.id === id ? { ...item, ...value } : item)), []);
  const remove = useCallback((id: string) => setCompletedMessages((current) => current.filter((item) => item.id !== id)), []);
  const reset = useCallback(() => {
    generationRef.current += 1;
    loadControllerRef.current?.abort();
    olderControllerRef.current?.abort();
    setCompletedMessages([]);
    setLoading(false);
    setHasOlder(false);
    setError(null);
  }, []);
  const reload = useCallback(() => conversationId ? load(conversationId) : Promise.resolve(), [conversationId, load]);

  return {
    completedMessages,
    loading,
    loadingOlder,
    hasOlder,
    error,
    setError,
    loadOlder,
    reload,
    replaceAll,
    append,
    replace,
    patch,
    remove,
    reset,
  };
}
