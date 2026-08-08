"use client";

import { useEffect } from "react";

const MAX_TIMER_MS = 2_147_000_000;

export function SessionExpiryGuard({ expiresAt }: { expiresAt?: string | null }) {
  useEffect(() => {
    if (!expiresAt) return;
    const expires = new Date(expiresAt).getTime();
    if (!Number.isFinite(expires)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loggingOut = false;

    const logout = async () => {
      if (loggingOut) return;
      loggingOut = true;
      await fetch("/api/auth/logout", { method: "POST", keepalive: true }).catch(() => undefined);
      window.location.replace("/login?reason=access-expired");
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      const remaining = expires - Date.now();
      if (remaining <= 0) {
        void logout();
        return;
      }
      timer = setTimeout(schedule, Math.min(remaining, MAX_TIMER_MS));
    };
    const checkOnResume = () => {
      if (document.visibilityState === "visible" && Date.now() >= expires) void logout();
    };
    schedule();
    document.addEventListener("visibilitychange", checkOnResume);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", checkOnResume);
    };
  }, [expiresAt]);

  return null;
}
