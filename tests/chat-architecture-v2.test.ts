import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("chat render and connection architecture", () => {
  it("separates workspace, sidebar, viewport, composer, uploads, and stream ownership", async () => {
    const workspace = await readFile("src/components/chat/chat-workspace.tsx", "utf8");
    for (const componentName of ["ConversationSidebar", "ChatHeader", "MessageViewport", "ChatComposer", "useConversationMessages", "useChatStream", "usePuterStream"]) {
      expect(workspace).toContain(componentName);
    }
    expect(workspace).not.toContain("setDraft");
    expect(workspace).not.toContain("XMLHttpRequest");
  });

  it("keeps completed history separate from the active streaming message", async () => {
    const [workspace, stream, list, content] = await Promise.all([
      readFile("src/components/chat/chat-workspace.tsx", "utf8"),
      readFile("src/components/chat/hooks/use-chat-stream.ts", "utf8"),
      readFile("src/components/chat/message-list.tsx", "utf8"),
      readFile("src/components/message-content.tsx", "utf8"),
    ]);
    expect(workspace).toContain("activeStreamingMessage");
    expect(workspace).toContain("completedMessages");
    expect(stream).toContain("requestAnimationFrame(flushDelta)");
    expect(stream).not.toContain("setCompletedMessages");
    expect(list).toContain("memo(function MessageList");
    expect(content).toContain("if (pending) return");
  });

  it("aborts streams, message loads, draft sync, searches, and uploads by owner", async () => {
    const sources = await Promise.all([
      "use-chat-stream.ts",
      "use-conversation-messages.ts",
      "use-draft.ts",
      "use-uploads.ts",
    ].map((name) => readFile(`src/components/chat/hooks/${name}`, "utf8")));
    for (const source of sources) expect(source).toContain("AbortController");
    expect(sources[0]).toContain("reader.cancel()");
    expect(sources[0]).toContain("if (generationRef.current");
    expect(sources[0]).toContain("setGenerating(false)");
    expect(sources[1]).toContain("generationRef");
    expect(sources[1]).toContain("setCompletedMessages([])");
    expect(sources[2]).toContain("SAVE_DELAY_MS = 1_200");
    expect(sources[2]).toContain("readyVersion !== versionRef.current");
    expect(sources[3]).toContain("cancelAll");
  });

  it("windows long message histories and exposes the bounded DOM count", async () => {
    const [hook, list] = await Promise.all([
      readFile("src/components/chat/hooks/use-virtual-message-window.ts", "utf8"),
      readFile("src/components/chat/message-list.tsx", "utf8"),
    ]);
    expect(hook).toContain("VIRTUALIZE_AFTER = 60");
    expect(hook).toContain("OVERSCAN_PX");
    expect(hook).toContain("firstOffsetAfter");
    expect(hook).toContain("requestAnimationFrame");
    expect(list).toContain("data-rendered-count");
    expect(list).toContain("topSpacer");
    expect(list).toContain("bottomSpacer");
  });

  it("loads model and knowledge catalogs only when their controls open", async () => {
    const [page, composer] = await Promise.all([
      readFile("src/app/dashboard/chat/page.tsx", "utf8"),
      readFile("src/components/chat/chat-composer.tsx", "utf8"),
    ]);
    expect(page).not.toContain("knowledgeBases.id");
    expect(composer).toContain("onFocus={() => void loadModels()}");
    expect(composer).toContain("loadKnowledge");
  });
});
