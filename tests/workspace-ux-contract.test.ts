import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("AI workspace UX architecture", () => {
  it("keeps mobile primary navigation to four entities plus More", async () => {
    const source = await readFile("src/components/dashboard-navigation.tsx", "utf8");
    const primaryBlock = source.slice(source.indexOf("const primaryMobile"), source.indexOf("const moreSections"));
    expect(primaryBlock).toContain('label: "الرئيسية"');
    expect(primaryBlock).toContain('label: "المحادثات"');
    expect(primaryBlock).toContain('label: "الوكلاء"');
    expect(primaryBlock).toContain('label: "التشغيلات"');
    expect((primaryBlock.match(/href:/g) ?? [])).toHaveLength(4);
    expect(source).toContain("<span>المزيد</span>");
  });

  it("uses server-backed global search instead of frontend-only entity data", async () => {
    const [navigation, route] = await Promise.all([
      readFile("src/components/dashboard-navigation.tsx", "utf8"),
      readFile("src/app/api/dashboard/search/route.ts", "utf8"),
    ]);
    expect(navigation).toContain("/api/dashboard/search?q=");
    expect(route).toContain("requireSession()");
    expect(route).toContain("eq(conversations.organizationId, session.organizationId)");
    expect(route).toContain("eq(agents.organizationId, session.organizationId)");
  });

  it("protects Arabic prose from character-by-character breaking and isolates technical LTR values", async () => {
    const css = await readFile("src/app/ai-workspace.css", "utf8");
    expect(css).toContain("word-break: normal");
    expect(css).toContain("unicode-bidi: isolate");
    expect(css).toContain("direction: ltr");
    expect(css).not.toContain(".arabic-prose {\n  word-break: break-all");
  });

  it("implements independent upload states and never renders upload progress for FAILED", async () => {
    const chat = await readFile("src/components/chat-console-v2.tsx", "utf8");
    for (const state of ["SELECTED", "VALIDATING", "UPLOADING", "PROCESSING", "READY", "PARTIALLY_READY", "FAILED", "CANCELLED"]) {
      expect(chat).toContain(`\"${state}\"`);
    }
    expect(chat).toContain('task.state === "UPLOADING" && task.progress !== null');
    expect(chat).toContain('task.state === "FAILED" || task.state === "CANCELLED"');
    expect(chat).not.toContain('task.state === "FAILED" && task.state === "UPLOADING"');
  });

  it("removes the floating Sandbox dock from chat and keeps it in progressive navigation", async () => {
    const [layout, navigation] = await Promise.all([
      readFile("src/app/dashboard/chat/layout.tsx", "utf8"),
      readFile("src/components/dashboard-navigation.tsx", "utf8"),
    ]);
    expect(layout).not.toContain("FloatingSandboxDock");
    expect(navigation).toContain('label: "Sandbox"');
  });

  it("contains explicit small-width and keyboard-safe responsive rules", async () => {
    const [workspaceCss, chatCss] = await Promise.all([
      readFile("src/app/ai-workspace.css", "utf8"),
      readFile("src/app/dashboard/chat/conversation-workspace.css", "utf8"),
    ]);
    expect(workspaceCss).toContain("@media (max-width: 430px)");
    expect(workspaceCss).toContain("@media (max-width: 350px)");
    expect(chatCss).toContain('html[data-chat-keyboard-open="true"] .mobile-bottom-nav');
    expect(chatCss).toContain("--chat-visual-height");
  });
});
