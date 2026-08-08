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

export function TurnstileWidget({ siteKey, action, onStatusChange }: { siteKey: string; action: "login" | "register"; onStatusChange?: (ready: boolean) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    let verified = false;
    let script: HTMLScriptElement | null = null;
    onStatusChange?.(false);
    const fail = () => {
      if (cancelled) return;
      setToken("");
      setStatus("error");
      onStatusChange?.(false);
    };
    const render = () => {
      if (cancelled || !container.current || !window.turnstile || widgetId) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action,
        language: "ar",
        theme: "auto",
        callback: (value: string) => {
          verified = true;
          setToken(value);
          setStatus("ready");
          onStatusChange?.(true);
        },
        "expired-callback": fail,
        "timeout-callback": fail,
        "error-callback": fail,
      });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile="true"]');
    if (existing) {
      existing.addEventListener("load", render);
      render();
    } else {
      script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = "true";
      script.addEventListener("load", render);
      document.head.appendChild(script);
    }
    const timeout = window.setTimeout(() => {
      if (!verified) fail();
    }, 15_000);
    return () => {
      cancelled = true;
      existing?.removeEventListener("load", render);
      script?.removeEventListener("load", render);
      window.clearTimeout(timeout);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [action, attempt, onStatusChange, siteKey]);

  function retry() {
    setToken("");
    setStatus("loading");
    onStatusChange?.(false);
    setAttempt((value) => value + 1);
  }

  return <div className="space-y-2">
    <div ref={container} className="flex min-h-[65px] justify-center" />
    <input type="hidden" name="turnstileToken" value={token} readOnly required />
    {status === "error" ? <div className="text-center text-xs text-rose-600" role="alert">تعذر إكمال التحقق الأمني. تحقق من الاتصال ثم <button type="button" className="underline" onClick={retry}>أعد المحاولة</button>.</div> : <p className="text-center text-xs text-stone-400">{status === "ready" ? "اكتمل التحقق الأمني." : "يتم التحقق الأمني الآن…"}</p>}
  </div>;
}
