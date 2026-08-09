"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { validateClientFile } from "@/lib/files/validation";
import { ApiClientError, apiErrorMessage, apiRequest } from "@/lib/http/client";
import type { Attachment, UploadTask } from "../types";

export const MAX_COMPOSER_ATTACHMENTS = 8;
const PROGRESS_RENDER_INTERVAL_MS = 100;
const PROGRESS_RENDER_STEP = 4;

export function uploadBusy(state: UploadTask["state"]) {
  return state === "SELECTED" || state === "VALIDATING" || state === "UPLOADING" || state === "PROCESSING";
}

function uploadReady(state: UploadTask["state"]) {
  return state === "READY" || state === "PARTIALLY_READY";
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Upload cancelled", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function useUploads(conversationId: string, onError: (message: string) => void) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const requestsRef = useRef(new Map<string, XMLHttpRequest>());
  const controllersRef = useRef(new Map<string, AbortController>());
  const progressRef = useRef(new Map<string, { at: number; progress: number | null }>());
  const ownerRef = useRef(0);

  const patch = useCallback((id: string, value: Partial<UploadTask>) => {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, ...value } : task));
  }, []);

  const patchProgress = useCallback((taskId: string, progress: number | null) => {
    const now = performance.now();
    const previous = progressRef.current.get(taskId);
    const advanced = progress !== null && (previous?.progress ?? -PROGRESS_RENDER_STEP) <= progress - PROGRESS_RENDER_STEP;
    if (progress !== 100 && previous && now - previous.at < PROGRESS_RENDER_INTERVAL_MS && !advanced) return;
    progressRef.current.set(taskId, { at: now, progress });
    patch(taskId, { state: "UPLOADING", progress });
  }, [patch]);

  const cancel = useCallback((taskId: string) => {
    controllersRef.current.get(taskId)?.abort();
    requestsRef.current.get(taskId)?.abort();
    controllersRef.current.delete(taskId);
    requestsRef.current.delete(taskId);
    progressRef.current.delete(taskId);
    patch(taskId, { state: "CANCELLED", progress: null, message: "أُلغي رفع الملف." });
  }, [patch]);

  const cancelAll = useCallback(() => {
    ownerRef.current += 1;
    for (const controller of controllersRef.current.values()) controller.abort();
    for (const request of requestsRef.current.values()) request.abort();
    controllersRef.current.clear();
    requestsRef.current.clear();
    progressRef.current.clear();
  }, []);

  useEffect(() => {
    cancelAll();
    queueMicrotask(() => setTasks([]));
    return cancelAll;
  }, [cancelAll, conversationId]);

  const uploadViaApplication = useCallback((taskId: string, file: File, signal: AbortSignal) => new Promise<Attachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    requestsRef.current.set(taskId, xhr);
    xhr.open("POST", "/api/dashboard/files");
    xhr.withCredentials = true;
    xhr.timeout = 120_000;
    xhr.setRequestHeader("accept", "application/json");
    xhr.setRequestHeader("x-request-id", crypto.randomUUID());
    const abort = () => xhr.abort();
    signal.addEventListener("abort", abort, { once: true });
    xhr.upload.onprogress = (event) => patchProgress(taskId, event.lengthComputable ? Math.min(99, Math.round(event.loaded / event.total * 100)) : null);
    xhr.upload.onload = () => patch(taskId, { state: "PROCESSING", progress: 100 });
    const finish = () => {
      signal.removeEventListener("abort", abort);
      requestsRef.current.delete(taskId);
      progressRef.current.delete(taskId);
    };
    xhr.onload = () => {
      finish();
      const payload = (() => { try { return JSON.parse(xhr.responseText) as { success?: boolean; data?: Attachment; error?: { message?: string } }; } catch { return null; } })();
      if (xhr.status >= 200 && xhr.status < 300 && payload?.success && payload.data) resolve(payload.data);
      else reject(new Error(payload?.error?.message ?? "تعذر رفع الملف."));
    };
    xhr.onerror = () => { finish(); reject(new Error("تعذر الاتصال بالخادم أثناء رفع الملف.")); };
    xhr.ontimeout = () => { finish(); reject(new Error("انتهت مهلة رفع الملف.")); };
    xhr.onabort = () => { finish(); reject(new DOMException("Upload cancelled", "AbortError")); };
    const form = new FormData();
    form.set("conversationId", conversationId);
    form.set("file", file);
    xhr.send(form);
  }), [conversationId, patch, patchProgress]);

  const uploadDirect = useCallback(async (taskId: string, file: File, signal: AbortSignal) => {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    let reservation: { attachment: Attachment; uploadUrl: string; requiredHeaders: Record<string, string> };
    try {
      reservation = await apiRequest("/api/dashboard/files/presigned", {
        method: "POST",
        signal,
        body: { conversationId, filename: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, sha256 },
      });
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.code === "DIRECT_UPLOAD_UNAVAILABLE") return uploadViaApplication(taskId, file, signal);
      throw cause;
    }
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      requestsRef.current.set(taskId, xhr);
      xhr.open("PUT", reservation.uploadUrl);
      xhr.timeout = 120_000;
      Object.entries(reservation.requiredHeaders).forEach(([name, value]) => xhr.setRequestHeader(name, value));
      const abort = () => xhr.abort();
      signal.addEventListener("abort", abort, { once: true });
      xhr.upload.onprogress = (event) => patchProgress(taskId, event.lengthComputable ? Math.min(99, Math.round(event.loaded / event.total * 100)) : null);
      const finish = () => {
        signal.removeEventListener("abort", abort);
        requestsRef.current.delete(taskId);
        progressRef.current.delete(taskId);
      };
      xhr.onload = () => {
        finish();
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error("رفض R2 الملف المرفوع."));
      };
      xhr.onerror = () => { finish(); reject(new Error("تعذر الاتصال بـ R2 أثناء الرفع.")); };
      xhr.ontimeout = () => { finish(); reject(new Error("انتهت مهلة الرفع المباشر.")); };
      xhr.onabort = () => { finish(); reject(new DOMException("Upload cancelled", "AbortError")); };
      xhr.send(file);
    });
    patch(taskId, { state: "PROCESSING", progress: 100 });
    let attachment = await apiRequest<Attachment>("/api/dashboard/files/presigned", { method: "PATCH", signal, body: { attachmentId: reservation.attachment.id } });
    for (let attempt = 0; attempt < 60 && attachment.processingStatus !== "ready" && attachment.processingStatus !== "failed"; attempt += 1) {
      await abortableDelay(1_000, signal);
      attachment = await apiRequest<Attachment>(`/api/dashboard/files/presigned?id=${encodeURIComponent(attachment.id)}`, { signal });
    }
    return attachment;
  }, [conversationId, patch, patchProgress, uploadViaApplication]);

  const process = useCallback(async (taskId: string, file: File) => {
    const owner = ownerRef.current;
    const controller = new AbortController();
    controllersRef.current.set(taskId, controller);
    progressRef.current.delete(taskId);
    patch(taskId, { state: "VALIDATING", progress: 0, message: null, attachment: null });
    const validation = validateClientFile(file);
    if (!validation.valid) {
      patch(taskId, { state: "FAILED", progress: null, message: validation.message });
      controllersRef.current.delete(taskId);
      return;
    }
    patch(taskId, { state: "UPLOADING", progress: 0 });
    try {
      const attachment = await uploadDirect(taskId, file, controller.signal);
      if (controller.signal.aborted || owner !== ownerRef.current) return;
      const state = attachment.intelligenceStatus ?? attachment.processingStatus ?? "ready";
      if (state === "ready") patch(taskId, { state: "READY", progress: 100, attachment, message: null });
      else if (state === "partially_ready") patch(taskId, { state: "PARTIALLY_READY", progress: 100, attachment, message: attachment.warnings?.[0] ?? "تمت فهرسة الجزء القابل للمعالجة." });
      else patch(taskId, { state: "FAILED", progress: null, attachment, message: attachment.warnings?.[0] ?? "تعذر تحليل الملف." });
    } catch (cause) {
      if (controller.signal.aborted || cause instanceof DOMException && cause.name === "AbortError") patch(taskId, { state: "CANCELLED", progress: null, message: "أُلغي رفع الملف." });
      else patch(taskId, { state: "FAILED", progress: null, message: cause instanceof Error ? cause.message : "تعذر رفع الملف." });
    } finally {
      controllersRef.current.delete(taskId);
      requestsRef.current.delete(taskId);
      progressRef.current.delete(taskId);
    }
  }, [patch, uploadDirect]);

  const add = useCallback((files: FileList | File[] | null) => {
    if (!files || !conversationId) return;
    const available = Math.max(0, MAX_COMPOSER_ATTACHMENTS - tasks.filter((task) => task.state !== "CANCELLED").length);
    const selected = Array.from(files).slice(0, available);
    const next = selected.map((file) => ({ id: crypto.randomUUID(), file, state: "SELECTED" as const, progress: 0 }));
    if (!next.length) return;
    setTasks((current) => [...current, ...next]);
    for (const task of next) void process(task.id, task.file);
  }, [conversationId, process, tasks]);

  const remove = useCallback(async (task: UploadTask) => {
    if (uploadBusy(task.state)) cancel(task.id);
    if (task.attachment) {
      try {
        await apiRequest("/api/dashboard/files", { method: "DELETE", body: { id: task.attachment.id } });
      } catch (cause) {
        onError(apiErrorMessage(cause, `تعذر إزالة ${task.file.name}.`));
        return;
      }
    }
    progressRef.current.delete(task.id);
    setTasks((current) => current.filter((item) => item.id !== task.id));
  }, [cancel, onError]);

  const retry = useCallback(async (task: UploadTask) => {
    if (task.attachment) await apiRequest("/api/dashboard/files", { method: "DELETE", body: { id: task.attachment.id } }).catch((cause) => onError(apiErrorMessage(cause, "تعذر تنظيف النسخة السابقة.")));
    await process(task.id, task.file);
  }, [onError, process]);

  const readyAttachments = useMemo(() => tasks.filter((task) => uploadReady(task.state) && task.attachment).map((task) => task.attachment!), [tasks]);
  const busy = tasks.some((task) => uploadBusy(task.state));
  const consume = useCallback(() => {
    progressRef.current.clear();
    setTasks([]);
  }, []);

  return { tasks, readyAttachments, busy, add, cancel, remove, retry, consume, cancelAll };
}
