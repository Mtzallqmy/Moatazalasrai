import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("chat experience workspace", () => {
  it("mounts the production conversation console and scoped responsive stylesheets", async () => {
    const page = await readFile("src/app/dashboard/chat/page.tsx", "utf8");
    expect(page).toContain("ChatConsoleV2");
    expect(page).toContain('import "./chat-experience.css"');
    expect(page).toContain('import "./conversation-workspace.css"');
    expect(page).toContain("chat-workspace-shell");
    expect(page).not.toContain("ChatExperienceToolbar");
  });

  it("keeps the legacy appearance toolbar contract available without mounting it in the primary conversation flow", async () => {
    const toolbar = await readFile("src/components/chat-experience-toolbar.tsx", "utf8");
    for (const path of ["/dashboard/agents", "/dashboard/channels", "/dashboard/integrations", "/dashboard/files"]) {
      expect(toolbar).toContain(path);
    }
    for (const preset of ['"platform"', '"whatsapp"', '"chatgpt"', '"telegram"']) {
      expect(toolbar).toContain(preset);
    }
    expect(toolbar).toContain("chatFontScale");
    expect(toolbar).toContain("chatDensity");
  });

  it("provides mobile layouts, readable message scales, density controls, and distinct presets", async () => {
    const css = await readFile("src/app/dashboard/chat/chat-experience.css", "utf8");
    expect(css).toContain("@media (max-width: 640px)");
    expect(css).toContain('[data-chat-font-scale="xl"]');
    expect(css).toContain('[data-chat-density="compact"]');
    expect(css).toContain('[data-chat-preset="whatsapp"]');
    expect(css).toContain('[data-chat-preset="chatgpt"]');
    expect(css).toContain('[data-chat-preset="telegram"]');
    expect(css).toContain(".chat-message");
    expect(css).toContain(".chat-composer");
  });
});
