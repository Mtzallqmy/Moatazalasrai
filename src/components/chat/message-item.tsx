"use client";

import dynamic from "next/dynamic";
import { memo } from "react";
import { Check, Copy, FileText, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { MessageContent } from "@/components/message-content";
import type { ActionDialog, Message } from "./types";

const TechnicalDetails = dynamic(() => import("@/components/workspace/technical-details").then((module) => module.TechnicalDetails));

function metadataString(message: Message, key: string) {
  const value = message.metadata?.[key];
  return typeof value === "string" ? value : null;
}

function toolCallCount(message: Message) {
  const value = message.metadata?.toolCalls;
  return Array.isArray(value) ? value.length : typeof value === "number" ? value : null;
}

function statusLabel(status: Message["status"]) {
  if (status === "sending") return "جارٍ الإرسال";
  if (status === "streaming") return "جارٍ إنشاء الرد";
  if (status === "cancelled") return "أُلغي الطلب";
  if (status === "interrupted") return "انقطع البث؛ الرد الظاهر غير مكتمل";
  if (status === "failed") return "تعذر إنشاء رد ناجح";
  return null;
}

export const MessageItem = memo(function MessageItem({ message, agentName, currentUserId, canManage, copied, showTechnicalDetails, onCopy, onAction }: {
  message: Message;
  agentName: string;
  currentUserId: string;
  canManage: boolean;
  copied: boolean;
  showTechnicalDetails: boolean;
  onCopy: (message: Message) => void;
  onAction: (dialog: ActionDialog) => void;
}) {
  const label = statusLabel(message.status);
  const transient = message.id.startsWith("stream-") || message.id.startsWith("local-");
  const canMutate = (message.authorUserId === currentUserId || canManage) && !transient;
  return (
    <article className={`chat-message ${message.role === "user" ? "chat-message-user" : "chat-message-assistant"}`} data-message-id={message.id}>
      <div className="message-author"><span>{message.role === "assistant" ? agentName : message.authorUserId === currentUserId ? "أنت" : message.authorName || message.authorEmail || "عضو"}</span>{message.role === "assistant" ? <span aria-hidden="true">✦</span> : null}</div>
      <MessageContent content={message.content} pending={message.status === "streaming" || message.status === "sending"} />
      {label ? <p className={`message-status message-status-${message.status}`} role={message.status === "failed" || message.status === "interrupted" ? "alert" : "status"}>{message.status === "streaming" ? <Loader2 size={13} className="animate-spin" /> : null}{label}</p> : null}
      {message.attachments?.length ? <div className="message-attachments">{message.attachments.map((file) => <a key={file.id} href={`/api/dashboard/files?id=${encodeURIComponent(file.id)}`}><FileText size={14} /><span>{file.filename}</span><small>{file.processingStatus === "ready" ? "جاهز" : "ملف"}</small></a>)}</div> : null}
      <footer className="message-footer">
        <time>{new Date(message.createdAt).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}</time>
        {message.content ? <button type="button" onClick={() => onCopy(message)} aria-label={copied ? "تم نسخ الرسالة" : "نسخ الرسالة"}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "تم النسخ" : "نسخ"}</button> : null}
        {canMutate || message.role === "user" && !message.id.startsWith("local-") ? <details className="message-actions-menu"><summary aria-label="إجراءات الرسالة"><MoreHorizontal size={16} /></summary><div>{message.role === "user" && canMutate ? <button type="button" onClick={() => onAction({ kind: "edit-message", message, value: message.content })}><Pencil size={13} /> تعديل وإعادة توليد</button> : null}{canMutate ? <button type="button" className="danger-menu-action" onClick={() => onAction({ kind: "delete-message", message })}><Trash2 size={13} /> حذف</button> : null}</div></details> : null}
      </footer>
      {showTechnicalDetails ? <TechnicalDetails model={message.model} provider={metadataString(message, "provider")} latencyMs={message.latencyMs} inputTokens={message.inputTokens} outputTokens={message.outputTokens} runId={metadataString(message, "runId")} errorCode={message.errorCode} toolCalls={toolCallCount(message)} /> : null}
    </article>
  );
});
