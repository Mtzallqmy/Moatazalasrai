"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render(element: HTMLElement, options: Record<string, unknown>): string;
      remove(widgetId: string): void;
    };
  }
}

export function TurnstileWidget({ siteKey, action }: { siteKey: string; action: "login" | "register" }) {
  const container = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState("");

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    const render = () => {
      if (cancelled || !container.current || !window.turnstile || widgetId) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action,
        language: "ar",
        theme: "auto",
        callback: (value: string) => setToken(value),
        "expired-callback": () => setToken(""),
        "error-callback": () => setToken(""),
      });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile="true"]');
    if (existing) {
      existing.addEventListener("load", render);
      render();
    } else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = "true";
      script.addEventListener("load", render);
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
      existing?.removeEventListener("load", render);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [action, siteKey]);

  return <div className="space-y-2"><div ref={container} className="flex min-h-[65px] justify-center" /><input type="hidden" name="turnstileToken" value={token} readOnly required /><p className="text-center text-xs text-stone-400">تحقق أمني يحمي الحساب من الاستخدام الآلي.</p></div>;
}
