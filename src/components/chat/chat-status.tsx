"use client";

import { memo } from "react";
import { Loader2 } from "lucide-react";

export const ChatStatus = memo(function ChatStatus({ status, error }: { status: string | null; error: string | null }) {
  if (!status && !error) return null;
  return (
    <div className={error ? "chat-status chat-status-error" : "chat-status"} role={error ? "alert" : "status"} aria-live="polite">
      {!error ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
      <span>{error ?? status}</span>
    </div>
  );
});
