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

  it("uses tenant-scoped server search with per-entity access constraints", async () => {
    const [navigation, route] = await Promise.all([
      readFile("src/components/dashboard-navigation-overlays.tsx", "utf8"),
      readFile("src/app/api/dashboard/search/route.ts", "utf8"),
    ]);
    expect(navigation).toContain("/api/dashboard/search?q=");
    expect(route).toContain("requireSession()");
    expect(route).toContain("conversationAccessFilter");
    expect(route).toContain("readableConversation");
    expect(route).toContain("session.role === \"member\" ? eq(attachments.uploadedByUserId, session.userId) : undefined");
    expect(route).toContain(".innerJoin(conversations, eq(conversations.id, runs.conversationId))");
    expect(route).toContain("eq(conversations.organizationId, session.organizationId)");
    expect(route).toContain("eq(agents.organizationId, session.organizationId)");
    expect(route).toContain("conversationId=");
  });

  it("protects Arabic prose from character-by-character breaking and isolates technical LTR values", async () => {
    const css = await readFile("src/app/ai-workspace.css", "utf8");
    expect(css).toContain("word-break: normal");
    expect(css).toContain("unicode-bidi: isolate");
    expect(css).toContain("direction: ltr");
    expect(css).not.toContain(".arabic-prose {\n  word-break: break-all");
  });

  it("implements independent upload states and never renders upload progress for FAILED", async () => {
    const [types, chat] = await Promise.all([
      readFile("src/components/chat/types.ts", "utf8"),
      readFile("src/components/chat/upload-tray.tsx", "utf8"),
    ]);
    for (const state of ["SELECTED", "VALIDATING", "UPLOADING", "PROCESSING", "READY", "PARTIALLY_READY", "FAILED", "CANCELLED"]) {
      expect(types).toContain(`\"${state}\"`);
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

  it("stores developer mode on the server and applies it to technical details", async () => {
    const [route, preference, developerMode, technical, setting] = await Promise.all([
      readFile("src/app/api/dashboard/preferences/developer-mode/route.ts", "utf8"),
      readFile("src/lib/preferences/developer-mode.ts", "utf8"),
      readFile("src/components/chat/hooks/use-developer-mode.ts", "utf8"),
      readFile("src/components/workspace/technical-details.tsx", "utf8"),
      readFile("src/components/developer-mode-setting.tsx", "utf8"),
    ]);
    expect(route).toContain("assertSameOrigin(request)");
    expect(preference).toContain("developer_mode_enabled");
    expect(developerMode).toContain("/api/dashboard/preferences/developer-mode");
    expect(setting).toContain("moataz:developer-mode");
    expect(developerMode).toContain("moataz:developer-mode");
    expect(technical).not.toContain("addEventListener");
  });

  it("keeps the dashboard shell persistent and defers expensive navigation overlays", async () => {
    const [layout, navigation] = await Promise.all([
      readFile("src/app/dashboard/layout.tsx", "utf8"),
      readFile("src/components/dashboard-navigation.tsx", "utf8"),
    ]);
    await expect(readFile("src/app/dashboard/template.tsx", "utf8")).rejects.toThrow();
    expect(layout).toContain("<DashboardNavigation");
    expect(navigation).toContain('dynamic(() => import("@/components/dashboard-navigation-overlays")');
    expect(navigation).toContain("drawerOpen ? <div");
  });
});
