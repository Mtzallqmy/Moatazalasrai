"use client";

import { memo } from "react";
import { FileText, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { humanFileSize } from "@/lib/files/validation";
import { uploadBusy } from "./hooks/use-uploads";
import type { UploadState, UploadTask } from "./types";

const labels: Record<UploadState, string> = {
  SELECTED: "تم الاختيار",
  VALIDATING: "جارٍ التحقق",
  UPLOADING: "جارٍ الرفع",
  PROCESSING: "جارٍ التحليل والفهرسة",
  READY: "جاهز",
  PARTIALLY_READY: "جاهز جزئيًا",
  FAILED: "فشل التحليل أو الرفع",
  CANCELLED: "أُلغي",
};

export const UploadTray = memo(function UploadTray({ tasks, onCancel, onRetry, onRemove }: {
  tasks: UploadTask[];
  onCancel: (id: string) => void;
  onRetry: (task: UploadTask) => void;
  onRemove: (task: UploadTask) => void;
}) {
  if (!tasks.length) return null;
  return <div className="composer-attachments" aria-label="المرفقات">{tasks.map((task) => (
    <div key={task.id} className={`attachment-item attachment-state-${task.state.toLowerCase()}`}>
      <FileText size={18} aria-hidden="true" />
      <div className="attachment-item-copy"><b>{task.file.name}</b><span>{humanFileSize(task.file.size)} · {labels[task.state]}</span>{task.message ? <small>{task.message}</small> : null}{task.state === "UPLOADING" && task.progress !== null ? <progress max="100" value={task.progress}>{task.progress}%</progress> : null}{task.state === "PROCESSING" ? <span className="attachment-processing"><Loader2 size={12} className="animate-spin" /> جارٍ تحليل الملف…</span> : null}{task.attachment?.chunkCount ? <small>{new Intl.NumberFormat("ar").format(task.attachment.chunkCount)} جزءًا مفهرسًا</small> : null}</div>
      <div className="attachment-item-actions">{uploadBusy(task.state) ? <button type="button" aria-label={`إلغاء ${task.file.name}`} onClick={() => onCancel(task.id)}><X size={16} /></button> : null}{task.state === "FAILED" || task.state === "CANCELLED" ? <button type="button" aria-label={`إعادة محاولة ${task.file.name}`} onClick={() => onRetry(task)}><RefreshCw size={15} /></button> : null}<button type="button" aria-label={`إزالة ${task.file.name}`} onClick={() => onRemove(task)}><Trash2 size={15} /></button></div>
    </div>
  ))}</div>;
});
