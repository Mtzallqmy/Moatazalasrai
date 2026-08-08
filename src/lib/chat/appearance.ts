export const chatThemeIds = ["moataz", "whatsapp", "telegram"] as const;
export const chatWallpaperIds = ["clean", "soft-grid", "doodles", "bubbles"] as const;

export type ChatThemeId = (typeof chatThemeIds)[number];
export type ChatWallpaperId = (typeof chatWallpaperIds)[number];

export type ChatAppearance = {
  theme: ChatThemeId;
  wallpaper: ChatWallpaperId;
};

export const defaultChatAppearance: ChatAppearance = {
  theme: "moataz",
  wallpaper: "soft-grid",
};

export const chatThemeOptions: ReadonlyArray<{
  id: ChatThemeId;
  label: string;
  description: string;
}> = [
  { id: "moataz", label: "معتز", description: "هوية المنصة الهادئة والمتزنة" },
  { id: "whatsapp", label: "واتساب", description: "ألوان خضراء دافئة مستوحاة من واتساب" },
  { id: "telegram", label: "تليجرام", description: "ألوان زرقاء صافية مستوحاة من تليجرام" },
];

export const chatWallpaperOptions: ReadonlyArray<{
  id: ChatWallpaperId;
  label: string;
  description: string;
}> = [
  { id: "clean", label: "نظيفة", description: "سطح هادئ بلا زخارف" },
  { id: "soft-grid", label: "شبكة ناعمة", description: "شبكة خفيفة تحافظ على هدوء مساحة القراءة" },
  { id: "doodles", label: "نقوش", description: "نقوش خفيفة تضيف شخصية دون تشتيت" },
  { id: "bubbles", label: "فقاعات", description: "نمط دائري خفيف مستوحى من المحادثات" },
];

export function normalizeChatAppearance(value?: { theme?: string | null; wallpaper?: string | null } | null): ChatAppearance {
  return {
    theme: chatThemeIds.includes(value?.theme as ChatThemeId) ? value!.theme as ChatThemeId : defaultChatAppearance.theme,
    wallpaper: chatWallpaperIds.includes(value?.wallpaper as ChatWallpaperId) ? value!.wallpaper as ChatWallpaperId : defaultChatAppearance.wallpaper,
  };
}
