"use client";

import { useState } from "react";
import { Braces, Loader2 } from "lucide-react";
import { apiErrorMessage, apiRequest } from "@/lib/http/client";

export function DeveloperModeSetting({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setSaving(true);
    setMessage(null);
    try {
      const result = await apiRequest<{ enabled: boolean }>("/api/dashboard/preferences/developer-mode", {
        method: "PUT",
        body: { enabled: next },
      });
      setEnabled(result.enabled);
      setMessage(result.enabled ? "تم تفعيل تفاصيل المطور." : "تم إخفاء تفاصيل المطور افتراضيًا.");
    } catch (cause) {
      setMessage(apiErrorMessage(cause, "تعذر حفظ الإعداد."));
    } finally {
      setSaving(false);
    }
  }

  return <section className="settings-card developer-mode-card">
    <div className="settings-card-icon"><Braces size={19} /></div>
    <div className="settings-card-copy"><h3>تفاصيل المطور</h3><p>يعرض Tokens وProvider وRun IDs والتفاصيل التشغيلية بشكل موسع للمستخدمين الذين يحتاجون التشخيص. الصلاحيات الفعلية لا تتغير.</p>{message ? <small role="status">{message}</small> : null}</div>
    <button type="button" className={`settings-toggle${enabled ? " is-on" : ""}`} aria-pressed={enabled} disabled={saving} onClick={() => void toggle()}>{saving ? <Loader2 size={15} className="animate-spin" /> : <span aria-hidden="true" />}{enabled ? "مفعّل" : "معطّل"}</button>
  </section>;
}
