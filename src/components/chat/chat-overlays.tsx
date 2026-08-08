"use client";

import { useEffect, useRef, type FormEvent } from "react";
import { Check, Loader2, X } from "lucide-react";
import { ConversationMembersPanel } from "@/components/conversation-members-panel";
import { chatThemeOptions, chatWallpaperOptions, type ChatAppearance, type ChatThemeId, type ChatWallpaperId } from "@/lib/chat/appearance";
import type { ActionDialog } from "./types";

export default function ChatOverlays({ conversationId, membersOpen, appearanceOpen, actionDialog, dialogBusy, savingAppearance, appearance, onCloseMembers, onCloseAppearance, onAppearance, onActionDialog, onSubmitAction }: {
  conversationId: string;
  membersOpen: boolean;
  appearanceOpen: boolean;
  actionDialog: ActionDialog | null;
  dialogBusy: boolean;
  savingAppearance: boolean;
  appearance: ChatAppearance;
  onCloseMembers: () => void;
  onCloseAppearance: () => void;
  onAppearance: (kind: "theme" | "wallpaper", value: ChatThemeId | ChatWallpaperId) => void;
  onActionDialog: (dialog: ActionDialog | null) => void;
  onSubmitAction: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!actionDialog) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape" && !dialogBusy) onActionDialog(null); };
    document.addEventListener("keydown", keydown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
    };
  }, [actionDialog, dialogBusy, onActionDialog]);
  return (
    <>
      {conversationId && membersOpen ? <ConversationMembersPanel conversationId={conversationId} open onClose={onCloseMembers} /> : null}
      {appearanceOpen ? <div className="mobile-sheet-overlay" role="presentation" onMouseDown={onCloseAppearance}><section className="mobile-sheet appearance-sheet" role="dialog" aria-modal="true" aria-label="مظهر المحادثة" onMouseDown={(event) => event.stopPropagation()}><div className="mobile-sheet-handle" /><header className="mobile-sheet-header"><div><h2>مظهر المحادثة</h2><p>يُحفظ اختيارك في حسابك على الخادم.</p></div><button type="button" className="icon-button" onClick={onCloseAppearance} aria-label="إغلاق"><X size={18} /></button></header><div className="appearance-sheet-grid"><div><h3>الثيم</h3>{chatThemeOptions.map((option) => <button key={option.id} type="button" disabled={savingAppearance} className={appearance.theme === option.id ? "is-selected" : ""} onClick={() => onAppearance("theme", option.id)}><span><b>{option.label}</b><small>{option.description}</small></span>{appearance.theme === option.id ? <Check size={15} /> : null}</button>)}</div><div><h3>الخلفية</h3>{chatWallpaperOptions.map((option) => <button key={option.id} type="button" disabled={savingAppearance} className={appearance.wallpaper === option.id ? "is-selected" : ""} onClick={() => onAppearance("wallpaper", option.id)}><span><b>{option.label}</b><small>{option.description}</small></span>{appearance.wallpaper === option.id ? <Check size={15} /> : null}</button>)}</div></div></section></div> : null}
      {actionDialog ? <div className="chat-dialog-overlay" role="presentation" onMouseDown={() => { if (!dialogBusy) onActionDialog(null); }}><form className="chat-action-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-action-dialog-title" onSubmit={onSubmitAction} onMouseDown={(event) => event.stopPropagation()}><header><div><h2 id="chat-action-dialog-title">{actionDialog.kind === "rename-conversation" ? "إعادة تسمية المحادثة" : actionDialog.kind === "edit-message" ? "تعديل الرسالة" : actionDialog.kind === "delete-conversation" ? "نقل المحادثة إلى المحذوفات" : "حذف الرسالة"}</h2><p>{actionDialog.kind === "edit-message" ? "سيُحفظ التعديل ثم يُنشأ رد جديد بالرسالة المعدلة." : actionDialog.kind === "delete-conversation" ? "ستختفي المحادثة من مساحة العمل وفق سياسة الاحتفاظ." : actionDialog.kind === "delete-message" ? "سيُحذف محتوى الرسالة من هذه المحادثة." : "اختر عنوانًا واضحًا يسهل العثور عليه لاحقًا."}</p></div><button type="button" className="icon-button" disabled={dialogBusy} onClick={() => onActionDialog(null)} aria-label="إغلاق"><X size={18} /></button></header>
        {actionDialog.kind === "rename-conversation" ? <input ref={(node) => { inputRef.current = node; }} className="form-control" maxLength={140} required value={actionDialog.value} onChange={(event) => onActionDialog({ ...actionDialog, value: event.target.value })} aria-label="عنوان المحادثة" /> : null}
        {actionDialog.kind === "edit-message" ? <textarea ref={(node) => { inputRef.current = node; }} className="form-control" maxLength={30000} required rows={6} value={actionDialog.value} onChange={(event) => onActionDialog({ ...actionDialog, value: event.target.value })} aria-label="محتوى الرسالة" /> : null}
        <div className="sheet-actions"><button type="button" className="secondary-button" disabled={dialogBusy} onClick={() => onActionDialog(null)}>إلغاء</button><button type="submit" className={actionDialog.kind.startsWith("delete") ? "danger-button" : "primary-button"} disabled={dialogBusy || "value" in actionDialog && !actionDialog.value.trim()}>{dialogBusy ? <Loader2 size={15} className="animate-spin" /> : null}{actionDialog.kind === "rename-conversation" ? "حفظ العنوان" : actionDialog.kind === "edit-message" ? "حفظ وإعادة التوليد" : "تأكيد الحذف"}</button></div>
      </form></div> : null}
    </>
  );
}
