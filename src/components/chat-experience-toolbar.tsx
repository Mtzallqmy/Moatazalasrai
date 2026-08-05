"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot, Cable, FileText, MessageCircleMore, Palette, Settings2, Sparkles, Type } from "lucide-react";

type ChatPreset = "platform" | "whatsapp" | "chatgpt" | "telegram";
type ChatFontScale = "sm" | "md" | "lg" | "xl";
type ChatDensity = "compact" | "comfortable" | "spacious";

type Preferences = {
  preset: ChatPreset;
  fontScale: ChatFontScale;
  density: ChatDensity;
};

const STORAGE_KEY = "moataz:chat-experience:v1";
const SYNC_EVENT = "moataz:chat-experience:sync";
const defaults: Preferences = { preset: "platform", fontScale: "md", density: "comfortable" };

const presets: Array<{ id: ChatPreset; label: string; description: string }> = [
  { id: "platform", label: "معتز", description: "هوية متزنة للمنصة" },
  { id: "whatsapp", label: "واتساب", description: "فقاعات مريحة وخضراء" },
  { id: "chatgpt", label: "ChatGPT", description: "قراءة هادئة ومساحة أوسع" },
  { id: "telegram", label: "تيليجرام", description: "أزرق واضح وخفيف" },
];

function applyPreferences(value: Preferences) {
  const root = document.documentElement;
  root.dataset.chatPreset = value.preset;
  root.dataset.chatFontScale = value.fontScale;
  root.dataset.chatDensity = value.density;
}

function readPreferences(): Preferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Preferences> | null;
    return {
      preset: presets.some((item) => item.id === parsed?.preset) ? parsed!.preset! : defaults.preset,
      fontScale: ["sm", "md", "lg", "xl"].includes(parsed?.fontScale ?? "") ? parsed!.fontScale! : defaults.fontScale,
      density: ["compact", "comfortable", "spacious"].includes(parsed?.density ?? "") ? parsed!.density! : defaults.density,
    };
  } catch {
    return defaults;
  }
}

export function ChatExperienceToolbar() {
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const synchronize = () => {
      const stored = readPreferences();
      setPreferences(stored);
      applyPreferences(stored);
    };
    window.addEventListener(SYNC_EVENT, synchronize);
    const frame = window.requestAnimationFrame(() => window.dispatchEvent(new Event(SYNC_EVENT)));
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener(SYNC_EVENT, synchronize);
    };
  }, []);

  function update(next: Preferences) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setPreferences(next);
    applyPreferences(next);
  }

  return (
    <section className="chat-workspace-toolbar" aria-label="أدوات ومسارات الدردشة">
      <div className="chat-workspace-toolbar__identity">
        <span className="chat-workspace-toolbar__icon"><MessageCircleMore size={20} /></span>
        <div>
          <p>مركز المحادثة</p>
          <span>الوكلاء والقنوات والملفات والتكاملات في مساحة واحدة</span>
        </div>
      </div>

      <nav className="chat-workspace-shortcuts" aria-label="روابط مساحة المحادثة">
        <Link href="/dashboard/agents"><Bot size={16} /> الوكلاء</Link>
        <Link href="/dashboard/channels"><Cable size={16} /> القنوات</Link>
        <Link href="/dashboard/integrations"><Sparkles size={16} /> التكاملات</Link>
        <Link href="/dashboard/files"><FileText size={16} /> الملفات</Link>
      </nav>

      <div className="chat-workspace-toolbar__actions">
        <button type="button" className="chat-toolbar-button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="chat-experience-panel">
          <Settings2 size={17} /> تخصيص الواجهة
        </button>
      </div>

      {open ? (
        <div id="chat-experience-panel" className="chat-experience-panel">
          <div className="chat-experience-panel__heading">
            <div><strong>تجربة القراءة والكتابة</strong><span>تطبق مباشرة وتحفظ في هذا المتصفح.</span></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق إعدادات الدردشة">×</button>
          </div>

          <div className="chat-experience-section">
            <p><Palette size={15} /> نمط المحادثة</p>
            <div className="chat-preset-grid">
              {presets.map((item) => (
                <button key={item.id} type="button" className={preferences.preset === item.id ? "is-selected" : ""}
                  onClick={() => update({ ...preferences, preset: item.id })}>
                  <span className={`chat-preset-swatch chat-preset-swatch--${item.id}`}><i /><i /></span>
                  <span><b>{item.label}</b><small>{item.description}</small></span>
                </button>
              ))}
            </div>
          </div>

          <div className="chat-experience-controls">
            <label>
              <span><Type size={15} /> حجم خط الرسائل</span>
              <select value={preferences.fontScale} onChange={(event) => update({ ...preferences, fontScale: event.target.value as ChatFontScale })}>
                <option value="sm">صغير</option>
                <option value="md">متوسط</option>
                <option value="lg">كبير</option>
                <option value="xl">كبير جدًا</option>
              </select>
            </label>
            <label>
              <span><MessageCircleMore size={15} /> كثافة التخطيط</span>
              <select value={preferences.density} onChange={(event) => update({ ...preferences, density: event.target.value as ChatDensity })}>
                <option value="compact">مضغوط</option>
                <option value="comfortable">متزن</option>
                <option value="spacious">واسع</option>
              </select>
            </label>
          </div>
        </div>
      ) : null}
    </section>
  );
}
