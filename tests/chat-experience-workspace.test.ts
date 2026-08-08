import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("chat experience workspace", () => {
  it("mounts the production conversation console and scoped responsive stylesheets", async () => {
    const page = await readFile("src/app/dashboard/chat/page.tsx", "utf8");
    expect(page).toContain("ChatConsoleV2");
    expect(page).toContain('import "./conversation-workspace.css"');
    expect(page).toContain("chat-workspace-shell");
    expect(page).not.toContain("ChatExperienceToolbar");
  });

  it("provides a scoped mobile, RTL, dark-mode conversation workspace without the retired toolbar", async () => {
    const css = await readFile("src/app/dashboard/chat/conversation-workspace.css", "utf8");
    expect(css).toContain("@media (max-width: 768px)");
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain("[dir=\"rtl\"]");
    expect(css).toContain(".chat-message");
    expect(css).toContain(".chat-composer");
  });

  it("keeps new chat usable before a conversation record exists", async () => {
    const [workspace, viewport, stream] = await Promise.all([
      readFile("src/components/chat/chat-workspace.tsx", "utf8"),
      readFile("src/components/chat/message-viewport.tsx", "utf8"),
      readFile("src/components/chat/hooks/use-chat-stream.ts", "utf8"),
    ]);
    expect(workspace).toContain("ensureConversation");
    expect(workspace).toContain("commitCreated");
    expect(viewport).toContain("اكتب رسالتك");
    expect(stream).toContain("stream-pending-");
  });

  it("shows verified provider models and streams preparation status immediately", async () => {
    const [chat, modelRoute, streamRoute, runtime] = await Promise.all([
      readFile("src/components/chat/chat-composer.tsx", "utf8"),
      readFile("src/app/api/dashboard/models/route.ts", "utf8"),
      readFile("src/app/api/dashboard/chat/stream/route.ts", "utf8"),
      readFile("src/lib/agents/runtime.ts", "utf8"),
    ]);
    expect(chat).toContain("modelGroups.map");
    expect(modelRoute).toContain("credential.allowedModels");
    expect(modelRoute).toContain("credential.discoveredModels");
    expect(runtime).toContain("...credential.allowedModels");
    expect(streamRoute).toContain('sse("status", { stage: "preparing"');
    expect(streamRoute.indexOf('stage: "preparing"')).toBeLessThan(streamRoute.indexOf("resolveAttachmentContext({"));
  });
});
