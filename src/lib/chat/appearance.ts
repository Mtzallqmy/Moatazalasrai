export const chatThemeIds = ["moataz", "whatsapp", "chatgpt", "telegram"] as const;
export const chatWallpaperIds = ["clean", "soft-grid", "doodles", "bubbles"] as const;
export const chatFontScaleIds = ["sm", "md", "lg", "xl"] as const;
export const chatDensityIds = ["compact", "comfortable", "spacious"] as const;

export type ChatThemeId = (typeof chatThemeIds)[number];
export type ChatWallpaperId = (typeof chatWallpaperIds)[number];
export type ChatFontScaleId = (typeof chatFontScaleIds)[number];
export type ChatDensityId = (typeof chatDensityIds)[number];

export type ChatAppearance = {
  theme: ChatThemeId;
  wallpaper: ChatWallpaperId;
  fontScale: ChatFontScaleId;
  density: ChatDensityId;
};

export const defaultChatAppearance: ChatAppearance = {
  theme: "moataz",
  wallpaper: "soft-grid",
  fontScale: "md",
  density: "comfortable",
};

export const chatThemeOptions: ReadonlyArray<{
  id: ChatThemeId;
  label: string;
  description: string;
}> = [
  { id: "moataz", label: "معتز", description: "هوية المنصة الهادئة والمتزنة" },
  { id: "whatsapp", label: "واتساب", description: "فقاعات خضراء مريحة للمحادثات اليومية" },
  { id: "chatgpt", label: "ChatGPT", description: "سطور أوسع وقراءة مريحة للنصوص الطويلة" },
  { id: "telegram", label: "تيليجرام", description: "ألوان زرقاء صافية وفقاعات خفيفة" },
];

export const chatWallpaperOptions: ReadonlyArray<{
  id: ChatWallpaperId;
  label: string;
}> = [
  { id: "clean", label: "نظيفة" },
  { id: "soft-grid", label: "شبكة ناعمة" },
  { id: "doodles", label: "نقوش" },
  { id: "bubbles", label: "فقاعات" },
];

export function normalizeChatAppearance(value?: {
  theme?: string | null;
  wallpaper?: string | null;
  fontScale?: string | null;
  density?: string | null;
} | null): ChatAppearance {
  return {
    theme: chatThemeIds.includes(value?.theme as ChatThemeId) ? value!.theme as ChatThemeId : defaultChatAppearance.theme,
    wallpaper: chatWallpaperIds.includes(value?.wallpaper as ChatWallpaperId) ? value!.wallpaper as ChatWallpaperId : defaultChatAppearance.wallpaper,
    fontScale: chatFontScaleIds.includes(value?.fontScale as ChatFontScaleId) ? value!.fontScale as ChatFontScaleId : defaultChatAppearance.fontScale,
    density: chatDensityIds.includes(value?.density as ChatDensityId) ? value!.density as ChatDensityId : defaultChatAppearance.density,
  };
}
