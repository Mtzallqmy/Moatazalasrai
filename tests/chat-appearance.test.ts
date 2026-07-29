import { describe, expect, it } from "vitest";
import {
  defaultChatAppearance,
  normalizeChatAppearance,
} from "@/lib/chat/appearance";
import { chatAppearanceSchema } from "@/lib/http/contracts";

describe("chat appearance", () => {
  it("accepts every persisted theme combination", () => {
    expect(chatAppearanceSchema.parse({ theme: "whatsapp", wallpaper: "doodles" }))
      .toEqual({ theme: "whatsapp", wallpaper: "doodles" });
  });

  it("falls back safely when stored database values are unknown", () => {
    expect(normalizeChatAppearance({ theme: "unknown", wallpaper: "legacy" }))
      .toEqual(defaultChatAppearance);
  });
});
