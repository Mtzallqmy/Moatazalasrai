"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/http/client";

let developerModeValue: boolean | null = null;
let developerModePromise: Promise<boolean> | null = null;

function loadDeveloperMode() {
  if (developerModeValue !== null) return Promise.resolve(developerModeValue);
  developerModePromise ??= apiRequest<{ enabled: boolean }>("/api/dashboard/preferences/developer-mode")
    .then((result) => (developerModeValue = result.enabled))
    .catch(() => (developerModeValue = false));
  return developerModePromise;
}

export function useDeveloperMode() {
  const [enabled, setEnabled] = useState(developerModeValue ?? false);
  useEffect(() => {
    let active = true;
    void loadDeveloperMode().then((value) => { if (active) setEnabled(value); });
    const onPreference = (event: Event) => {
      const value = (event as CustomEvent<{ enabled?: boolean }>).detail?.enabled;
      if (typeof value !== "boolean") return;
      developerModeValue = value;
      setEnabled(value);
    };
    window.addEventListener("moataz:developer-mode", onPreference);
    return () => { active = false; window.removeEventListener("moataz:developer-mode", onPreference); };
  }, []);
  return enabled;
}
