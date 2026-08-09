"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { splitServerEvents } from "@/lib/chat/sse";
import { apiRequest } from "@/lib/http/client";
import type { Message, SendOptions } from "../types";

export type StreamCallbacks = {
  onOptimisticUser: (message: Message) => void;
  onServerUser: (optimisticId: string, message: Message) => void;
  onAssistantComplete: (message: Message) => void;
  onUserFailed: (optimisticId: string, status: "failed" | "cancelled") => void;
  onRefreshRequired: () => Promise<void>;
};

type ApiErrorPayload = { error?: { code?: string; message?: string } };

const STREAM_RENDER_INTERVAL_MS = 50;

export function useChatStream(ownerKey: string, currentUser: { id: string; name: string; email: string }, callbacks: StreamCallbacks) {
  const [activeStreamingMessage, setActiveStreamingMessage] = useState<Message | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryText, setRetryText] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  const clearScheduled = useCallback(() => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    timeoutRef.current = null;
    flushTimerRef.current = null;
    frameRef.current = null;
  }, []);

  const cancel = useCallback((reason = "تم إيقاف التوليد.") => {
    generationRef.current = null;
    controllerRef.current?.abort(new DOMException(reason, "AbortError"));
    controllerRef.current = null;
    clearScheduled();
    setActiveStreamingMessage((current) => current ? { ...current, status: "cancelled" } : null);
    setGenerating(false);
    setStatus(null);
    runIdRef.current = null;
  }, [clearScheduled]);

  useEffect(() => {
    queueMicrotask(() => {
      setActiveStreamingMessage(null);
      setStatus(null);
      setError(null);
      setRetryText(null);
      setGenerating(false);
    });
    return () => {
      generationRef.current = null;
      controllerRef.current?.abort(new DOMException("Chat owner changed", "AbortError"));
      controllerRef.current = null;
      runIdRef.current = null;
      clearScheduled();
    };
  }, [ownerKey, clearScheduled]);

  const stop = useCallback(async () => {
    const runId = runIdRef.current;
    cancel();
    if (runId) await apiRequest("/api/dashboard/runs", { method: "DELETE", body: { runId } }).catch(() => undefined);
  }, [cancel]);

  const send = useCallback(async (conversationId: string, options: SendOptions) => {
    if (generationRef.current || !options.text.trim()) return false;
    cancel();
    const generationId = crypto.randomUUID();
    const optimisticId = `local-${crypto.randomUUID()}`;
    const initialAssistant: Message = {
      id: `stream-pending-${crypto.randomUUID()}`,
      role: "assistant",
      content: "",
      status: "streaming",
      createdAt: new Date().toISOString(),
    };
    const optimisticUser: Message = {
      id: optimisticId,
      role: "user",
      authorUserId: currentUser.id,
      authorName: currentUser.name,
      authorEmail: currentUser.email,
      content: options.text.trim(),
      attachments: options.attachments,
      status: "sending",
      createdAt: new Date().toISOString(),
    };
    generationRef.current = generationId;
    callbacks.onOptimisticUser(optimisticUser);
    setActiveStreamingMessage(initialAssistant);
    setGenerating(true);
    setStatus("جارٍ بدء الطلب…");
    setError(null);
    setRetryText(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    let responseStarted = false;
    let responseTimedOut = false;
    let sawServerMessage = false;
    let activeSnapshot = initialAssistant;
    let pendingDelta = "";
    let completed = false;
    const isActive = () => generationRef.current === generationId;
    const flushDelta = () => {
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      flushTimerRef.current = null;
      frameRef.current = null;
      if (!pendingDelta || !isActive()) return;
      const delta = pendingDelta;
      pendingDelta = "";
      activeSnapshot = { ...activeSnapshot, content: activeSnapshot.content + delta };
      startTransition(() => setActiveStreamingMessage(activeSnapshot));
    };
    const scheduleDeltaFlush = () => {
      if (flushTimerRef.current !== null || frameRef.current !== null) return;
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = null;
          flushDelta();
        });
      }, STREAM_RENDER_INTERVAL_MS);
    };
    timeoutRef.current = window.setTimeout(() => {
      if (!responseStarted) {
        responseTimedOut = true;
        controller.abort(new DOMException("Response timeout", "TimeoutError"));
      }
    }, 30_000);

    try {
      const response = await fetch("/api/dashboard/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": crypto.randomUUID() },
        body: JSON.stringify({
          conversationId,
          message: options.text.trim(),
          attachmentIds: options.attachments.map((file) => file.id),
          clientRequestId: crypto.randomUUID(),
          inputKind: options.attachments.length ? "file" : "text",
          ...(options.knowledgeBaseId ? { knowledgeBaseId: options.knowledgeBaseId } : {}),
          useMemory: options.useMemory,
          ...(options.providerCredentialId && options.model ? { providerCredentialId: options.providerCredentialId, model: options.model } : {}),
        }),
        signal: controller.signal,
      });
      responseStarted = true;
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as ApiErrorPayload | null;
        throw new Error(payload?.error?.message ?? "تعذر تشغيل الوكيل.");
      }
      if (!response.body) throw new Error("لم يبدأ الخادم بث الاستجابة.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (!isActive()) {
          await reader.cancel().catch(() => undefined);
          return false;
        }
        buffer += decoder.decode(value, { stream: !done });
        const parsed = splitServerEvents(buffer, done);
        buffer = parsed.remainder;
        for (const item of parsed.events) {
          if (item.data === "[DONE]" || !isActive()) continue;
          const data = JSON.parse(item.data) as Record<string, unknown>;
          if (item.event === "status" && typeof data.message === "string") startTransition(() => setStatus(data.message as string));
          if (item.event === "message" && data.userMessage) {
            sawServerMessage = true;
            callbacks.onServerUser(optimisticId, data.userMessage as Message);
          }
          if (item.event === "run" && typeof data.runId === "string") {
            flushDelta();
            runIdRef.current = data.runId;
            activeSnapshot = { ...activeSnapshot, id: `stream-${data.runId}`, metadata: { ...(activeSnapshot.metadata ?? {}), runId: data.runId } };
            startTransition(() => setActiveStreamingMessage(activeSnapshot));
          }
          if (item.event === "delta" && typeof data.text === "string") {
            pendingDelta += data.text;
            scheduleDeltaFlush();
          }
          if (item.event === "complete" && typeof data.messageId === "string") {
            flushDelta();
            activeSnapshot = {
              ...activeSnapshot,
              id: data.messageId,
              status: "completed",
              metadata: { ...(activeSnapshot.metadata ?? {}), fallbackUsed: data.fallbackUsed === true },
            };
            callbacks.onAssistantComplete(activeSnapshot);
            setActiveStreamingMessage(null);
            setStatus(data.fallbackUsed === true ? "اكتمل الرد عبر مزوّد بديل." : null);
            setRetryText(null);
            completed = true;
          }
          if (item.event === "error") {
            flushDelta();
            throw new Error(typeof data.message === "string" ? data.message : "تعذر تشغيل الوكيل.");
          }
        }
        if (done) break;
      }
      flushDelta();
      if (!sawServerMessage && isActive()) await callbacks.onRefreshRequired();
      return completed;
    } catch (cause) {
      if (!isActive()) return false;
      const aborted = controller.signal.aborted || cause instanceof DOMException && cause.name === "AbortError";
      callbacks.onUserFailed(optimisticId, aborted ? "cancelled" : "failed");
      flushDelta();
      if (!completed && activeSnapshot) {
        callbacks.onAssistantComplete({
          ...activeSnapshot,
          status: aborted ? "cancelled" : activeSnapshot.content.trim() ? "interrupted" : "failed",
          errorCode: aborted ? undefined : "PROVIDER_REQUEST_FAILED",
        });
        setActiveStreamingMessage(null);
      }
      setError(aborted ? responseTimedOut ? "لم يبدأ الخادم الاستجابة خلال 30 ثانية." : "تم إيقاف التوليد." : cause instanceof Error ? cause.message : "تعذر تشغيل الوكيل.");
      if (!aborted) setRetryText(options.text.trim());
      return false;
    } finally {
      clearScheduled();
      if (isActive()) {
        generationRef.current = null;
        controllerRef.current = null;
        runIdRef.current = null;
        setGenerating(false);
        if (!completed) setStatus(null);
      }
    }
  }, [callbacks, cancel, clearScheduled, currentUser.email, currentUser.id, currentUser.name]);

  return { activeStreamingMessage, status, error, retryText, generating, send, stop, cancel, setError, setRetryText };
}
