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

  it("keeps completed history separate and batches streaming paints below input priority", async () => {
    const [workspace, stream, puterStream, list, content] = await Promise.all([
      readFile("src/components/chat/chat-workspace.tsx", "utf8"),
      readFile("src/components/chat/hooks/use-chat-stream.ts", "utf8"),
      readFile("src/components/chat/hooks/use-puter-stream.ts", "utf8"),
      readFile("src/components/chat/message-list.tsx", "utf8"),
      readFile("src/components/message-content.tsx", "utf8"),
    ]);
    expect(workspace).toContain("activeStreamingMessage");
    expect(workspace).toContain("completedMessages");
    for (const source of [stream, puterStream]) {
      expect(source).toContain("STREAM_RENDER_INTERVAL_MS = 50");
      expect(source).toContain("startTransition");
      expect(source).toContain("requestAnimationFrame");
    }
    expect(stream).not.toContain("setCompletedMessages");
    expect(list).toContain("memo(function MessageList");
    expect(content).toContain("if (pending) return");
  });

  it("aborts owned work and debounces both local and server draft persistence", async () => {
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
    expect(sources[2]).toContain("LOCAL_SAVE_DELAY_MS = 250");
    expect(sources[2]).toContain("localSaveRef");
    expect(sources[2]).toContain("readyVersion !== versionRef.current");
    expect(sources[3]).toContain("cancelAll");
    expect(sources[3]).toContain("PROGRESS_RENDER_INTERVAL_MS = 100");
  });

  it("keeps typing and conversation navigation responsive while a response is generating", async () => {
    const [composer, sidebar, autoScroll, performanceCss] = await Promise.all([
      readFile("src/components/chat/chat-composer.tsx", "utf8"),
      readFile("src/components/chat/conversation-sidebar.tsx", "utf8"),
      readFile("src/components/chat/hooks/use-auto-scroll.ts", "utf8"),
      readFile("src/app/dashboard/dashboard-performance.css", "utf8"),
    ]);
    expect(composer).toContain('disabled={!agentsAvailable || !canWrite}');
    expect(composer).not.toContain('disabled={!agentsAvailable || !canWrite || generating}');
    expect(composer).toContain("viewportFrameRef");
    expect(composer).toContain('CSS.supports("field-sizing", "content")');
    expect(sidebar).toContain('disabled={!agents.length}');
    expect(sidebar).not.toContain('disabled={busy || !agents.length}');
    expect(autoScroll).toContain("scrollFrameRef");
    expect(autoScroll).toContain("updateLatest");
    expect(performanceCss).toContain("touch-action: manipulation");
    expect(performanceCss).toContain("(pointer: coarse)");
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
    expect(hook).toContain("pendingMeasurementsRef");
    expect(hook).not.toContain("getBoundingClientRect");
    expect(list).toContain("data-rendered-count");
    expect(list).toContain("topSpacer");
    expect(list).toContain("bottomSpacer");
  });

  it("keeps the composer inside a bounded chat viewport on mobile", async () => {
    const [page, shell, css] = await Promise.all([
      readFile("src/app/dashboard/chat/page.tsx", "utf8"),
      readFile("src/components/dashboard-shell.tsx", "utf8"),
      readFile("src/app/dashboard/chat/conversation-workspace.css", "utf8"),
    ]);
    expect(page).toContain('variant="chat"');
    expect(shell).toContain("dashboard-content-chat");
    expect(css).toContain("grid-template-rows: minmax(0, 1fr)");
    expect(css).toContain(".conversation-list-scroll");
    expect(css).toContain('html[data-chat-keyboard-open="true"] .chat-workspace-shell');
    expect(css).toContain("position: relative");
    expect(css).not.toContain("inset-block-end: calc(4.45rem");
  });

  it("parallelizes pre-stream work and resolves directly linked conversations", async () => {
    const [page, streamRoute] = await Promise.all([
      readFile("src/app/dashboard/chat/page.tsx", "utf8"),
      readFile("src/app/api/dashboard/chat/stream/route.ts", "utf8"),
    ]);
    expect(streamRoute).toContain("const [session, body] = await Promise.all");
    expect(streamRoute).toContain("enforceRateLimit");
    expect(page).toContain("requestedConversation");
    expect(page).toContain("visibleRows");
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
