import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Telegram platform client runtime", () => {
  it("stores multi-step flow state durably with optimistic locking", async () => {
    const migration = await readFile("drizzle/0041_telegram_user_sessions.sql", "utf8");
    const service = await readFile("src/lib/telegram/session-service.ts", "utf8");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "telegram_user_sessions"');
    expect(migration).toContain('"active_flow" text');
    expect(migration).toContain('"state" jsonb');
    expect(migration).toContain('"version" integer');
    expect(service).toContain("expectedVersion");
    expect(service).toContain("TELEGRAM_SESSION_CONFLICT");
    expect(service).toContain('"team.run"');
  });

  it("keeps the webhook thin and moves heavy work to Graphile Worker", async () => {
    const webhook = await readFile("src/app/api/webhooks/telegram/route.ts", "utf8");
    const queue = await readFile("src/worker/queue.ts", "utf8");
    const tasks = await readFile("src/worker/task-list.ts", "utf8");
    expect(webhook).toContain("enqueueTelegramUpdate");
    expect(webhook).not.toContain("executeAgentRun");
    expect(webhook).not.toContain("createAgent");
    expect(queue).toContain('addJob("telegram-update-process"');
    expect(tasks).toContain('"telegram-update-process": telegramUpdateProcessTask');
  });

  it("uses the same agent and conversation application services from dashboard and Telegram", async () => {
    const agentRoute = await readFile("src/app/api/dashboard/agents/route.ts", "utf8");
    const chatRoute = await readFile("src/app/api/dashboard/chat/route.ts", "utf8");
    const agentFlow = await readFile("src/lib/telegram/agent-flows.ts", "utf8");
    const conversationFlow = await readFile("src/lib/telegram/conversation-flows.ts", "utf8");
    expect(agentRoute).toContain("createAgent(");
    expect(agentFlow).toContain("createAgent(");
    expect(chatRoute).toContain("createConversationForAgent(");
    expect(conversationFlow).toContain("createConversationForAgent(");
  });

  it("hides unsupported capabilities and builds menus from the registry", async () => {
    const registry = await readFile("src/lib/telegram/capability-registry.ts", "utf8");
    const menu = await readFile("src/lib/telegram/menu-renderer.ts", "utf8");
    expect(registry).toContain("requiredPermission");
    expect(registry).toContain("telegramFeatureKey");
    expect(registry).toContain("requiredPlatformModule");
    expect(menu).toContain("resolveTelegramCapabilities");
    expect(menu).not.toContain("GitHub والمستودعات");
    expect(menu).not.toContain("مهام المتصفح");
  });

  it("uses real team runtime services and queues team runs", async () => {
    const flow = await readFile("src/lib/telegram/team-flows.ts", "utf8");
    const processor = await readFile("src/lib/telegram/update-processor.ts", "utf8");
    const setup = await readFile("scripts/setup-telegram-webhook.mjs", "utf8");
    expect(flow).toContain("createAgentTeamRun");
    expect(flow).toContain("cancelAgentTeamRun");
    expect(flow).toContain("retryAgentTeamRun");
    expect(flow).toContain("agentTeamRunsRuntime");
    expect(flow).toContain("agentTeamRunStepsRuntime");
    expect(processor).toContain("handleTelegramTeamRunText");
    expect(processor).toContain("team:run:confirm");
    expect(setup).toContain('{ command: "teams"');
    expect(setup).toContain('{ command: "runs"');
  });

  it("uses the real approval store and resume queues instead of static approval text", async () => {
    const flow = await readFile("src/lib/telegram/approval-flows.ts", "utf8");
    const processor = await readFile("src/lib/telegram/update-processor.ts", "utf8");
    const setup = await readFile("scripts/setup-telegram-webhook.mjs", "utf8");
    expect(flow).toContain("listPendingToolApprovals");
    expect(flow).toContain("getToolApproval");
    expect(flow).toContain("decideToolApproval");
    expect(flow).toContain("enqueueAgentRunResume");
    expect(flow).toContain("enqueueBrowserResume");
    expect(flow).toContain("enqueueSandboxResume");
    expect(processor).toContain('input.action === "approvals:list"');
    expect(processor).toContain("approval:decide:");
    expect(setup).toContain('{ command: "approvals"');
  });

  it("downloads and stores media through the existing channel pipeline", async () => {
    const flow = await readFile("src/lib/telegram/file-flows.ts", "utf8");
    const processor = await readFile("src/lib/telegram/update-processor.ts", "utf8");
    const adapter = await readFile("src/lib/channels/telegram-adapter.ts", "utf8");
    expect(flow).toContain("telegramFeatureAllowed");
    expect(flow).toContain('permission: "files:upload"');
    expect(flow).toContain("getUsableChannelAgent");
    expect(flow).toContain("telegramChannelAdapter.normalizeIncoming");
    expect(flow).toContain("routeIncomingChannelMessage");
    expect(flow).toContain("setTelegramConversation");
    expect(adapter).toContain("downloadTelegramFile");
    expect(processor).toContain("handleTelegramMedia");
  });

  it("rejects empty Telegram messages, restores file downloads and splits long output", async () => {
    const renderer = await readFile("src/lib/telegram/message-renderer.ts", "utf8");
    const client = await readFile("src/lib/integrations/telegram.ts", "utf8");
    expect(renderer).toContain("splitText");
    expect(renderer).toContain("filter(Boolean)");
    expect(client).toContain("TELEGRAM_EMPTY_MESSAGE");
    expect(client).toContain("if (!text)");
    expect(client).toContain("downloadTelegramFile");
    expect(client).toContain("20 * 1024 * 1024");
  });

  it("does not cancel agent creation when a normal name is received", async () => {
    const flow = await readFile("src/lib/telegram/agent-flows.ts", "utf8");
    expect(flow).toContain('session.currentStep === "name"');
    expect(flow).toContain('step: "description"');
    expect(flow).toContain("استخدم /cancel فقط للإلغاء");
    expect(flow).not.toContain('input.text === "مساعد المحتوى"');
  });
});
