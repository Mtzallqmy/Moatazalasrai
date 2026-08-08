"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/http/client";
import type { PuterChatMessage } from "@/lib/puter/types";
import type { Message } from "../types";
import type { StreamCallbacks } from "./use-chat-stream";

export function usePuterStream(ownerKey: string, currentUser: { id: string; name: string; email: string }, callbacks: StreamCallbacks) {
  const [activeStreamingMessage, setActiveStreamingMessage] = useState<Message | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef<string | null>(null);
  const executionRef = useRef<{ executionId: string; userMessageId: string; model: string; conversationId: string } | null>(null);
  const frameRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    const execution = executionRef.current;
    generationRef.current = null;
    controllerRef.current?.abort(new DOMException("Puter cancelled", "AbortError"));
    controllerRef.current = null;
    executionRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    setGenerating(false);
    setStatus(null);
    if (execution) void apiRequest("/api/dashboard/chat/puter", {
      method: "PATCH",
      body: { conversationId: execution.conversationId, executionId: execution.executionId, userMessageId: execution.userMessageId, model: execution.model, status: "cancelled" },
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setActiveStreamingMessage(null);
      setStatus(null);
      setError(null);
      setGenerating(false);
    });
    return () => {
      const execution = executionRef.current;
      generationRef.current = null;
      controllerRef.current?.abort(new DOMException("Puter owner changed", "AbortError"));
      controllerRef.current = null;
      executionRef.current = null;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      if (execution) void apiRequest("/api/dashboard/chat/puter", {
        method: "PATCH",
        body: { conversationId: execution.conversationId, executionId: execution.executionId, userMessageId: execution.userMessageId, model: execution.model, status: "cancelled" },
      }).catch(() => undefined);
    };
  }, [ownerKey]);

  const finish = useCallback(async (input: { executionId: string; userMessageId: string; model: string; conversationId: string }, state: "completed" | "failed" | "cancelled", content?: string) => {
    const result = await apiRequest<{ assistantMessage: Message | null }>("/api/dashboard/chat/puter", {
      method: "PATCH",
      body: { conversationId: input.conversationId, executionId: input.executionId, userMessageId: input.userMessageId, model: input.model, status: state, ...(content ? { content } : {}) },
    });
    return result.assistantMessage;
  }, []);

  const stop = useCallback(async () => {
    cancel();
    setActiveStreamingMessage((current) => current ? { ...current, status: "cancelled" } : null);
  }, [cancel]);

  const send = useCallback(async (conversationId: string, text: string, model: string) => {
    if (generationRef.current || !text.trim() || !model) return false;
    const generationId = crypto.randomUUID();
    const optimisticId = `local-${crypto.randomUUID()}`;
    const optimistic: Message = { id: optimisticId, role: "user", authorUserId: currentUser.id, authorName: currentUser.name, authorEmail: currentUser.email, content: text.trim(), status: "sending", createdAt: new Date().toISOString(), attachments: [] };
    callbacks.onOptimisticUser(optimistic);
    generationRef.current = generationId;
    const controller = new AbortController();
    controllerRef.current = controller;
    setGenerating(true);
    setError(null);
    setStatus("جارٍ الاتصال بـ Puter…");
    let active: Message | null = null;
    let pending = "";
    const flush = () => {
      frameRef.current = null;
      if (!pending || generationRef.current !== generationId || !active) return;
      active = { ...active, content: active.content + pending };
      pending = "";
      setActiveStreamingMessage(active);
    };
    try {
      const [{ getPuterClient }, { streamPuterChat }] = await Promise.all([
        import("@/lib/puter/client"),
        import("@/lib/puter/chat"),
      ]);
      const client = await getPuterClient();
      if (!client.auth.isSignedIn()) throw new Error("اتصل بحساب Puter قبل بدء الدردشة.");
      const result = await apiRequest<{ executionId: string; userMessage: Message; messages: PuterChatMessage[] }>("/api/dashboard/chat/puter", {
        method: "POST",
        signal: controller.signal,
        body: { conversationId, message: text.trim(), model, clientRequestId: crypto.randomUUID() },
      });
      if (generationRef.current !== generationId) return false;
      callbacks.onServerUser(optimisticId, { ...result.userMessage, authorName: currentUser.name, authorEmail: currentUser.email });
      const execution = { executionId: result.executionId, userMessageId: result.userMessage.id, model, conversationId };
      executionRef.current = execution;
      active = { id: `stream-puter-${result.executionId}`, role: "assistant", content: "", status: "streaming", model, createdAt: new Date().toISOString(), metadata: { provider: "puter", executionSource: "client", runId: result.executionId } };
      setActiveStreamingMessage(active);
      setStatus("جارٍ إنشاء الرد…");
      const finalText = await streamPuterChat({ client, messages: result.messages, model, signal: controller.signal, onText(delta) {
        pending += delta;
        if (frameRef.current === null) frameRef.current = requestAnimationFrame(flush);
      } });
      flush();
      if (generationRef.current !== generationId) return false;
      const saved = await finish(execution, "completed", finalText);
      callbacks.onAssistantComplete(saved ?? { ...active, content: finalText, status: "completed" });
      setActiveStreamingMessage(null);
      setStatus(null);
      return true;
    } catch (cause) {
      if (generationRef.current !== generationId) return false;
      const cancelled = controller.signal.aborted || cause instanceof DOMException && cause.name === "AbortError";
      const execution = executionRef.current;
      if (execution) await finish(execution, cancelled ? "cancelled" : "failed").catch(() => undefined);
      callbacks.onUserFailed(optimisticId, cancelled ? "cancelled" : "failed");
      flush();
      if (active) callbacks.onAssistantComplete({ ...active, status: cancelled ? "cancelled" : active.content.trim() ? "interrupted" : "failed" });
      setActiveStreamingMessage(null);
      setError(cancelled ? "تم إيقاف استجابة Puter." : cause instanceof Error ? cause.message : "تعذر تشغيل Puter.");
      return false;
    } finally {
      if (generationRef.current === generationId) {
        generationRef.current = null;
        controllerRef.current = null;
        executionRef.current = null;
        setGenerating(false);
      }
    }
  }, [callbacks, currentUser.email, currentUser.id, currentUser.name, finish]);

  return { activeStreamingMessage, status, error, generating, send, stop, cancel, setError };
}
