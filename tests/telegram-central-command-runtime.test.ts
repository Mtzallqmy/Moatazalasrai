import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  updateWhere: vi.fn(async () => []),
  sendMessage: vi.fn(async () => ({ message_id: 1 })),
  answerCallback: vi.fn(async () => true),
  consumeCode: vi.fn(),
  resolveAccount: vi.fn(),
  enabledFeatures: vi.fn(async () => ["telegram.chat", "telegram.agents"]),
  pending: [] as Promise<unknown>[],
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (callback: () => unknown) => {
      mocks.pending.push(Promise.resolve().then(callback));
    },
  };
});

vi.mock("@/db", () => ({
  db: () => ({
    execute: mocks.execute,
    update: () => ({ set: () => ({ where: mocks.updateWhere }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve([]) }) }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => [] }),
          limit: async () => [],
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/integrations/telegram", () => ({
  answerTelegramCallback: mocks.answerCallback,
  sendTelegramMessage: mocks.sendMessage,
}));

vi.mock("@/lib/integrations/telegram-platform", () => ({
  centralTelegramBot: vi.fn(async () => ({ id: 1, username: "central_bot", token: "test-token" })),
  consumeTelegramLinkCode: mocks.consumeCode,
  resolveTelegramAccount: mocks.resolveAccount,
  telegramEnabledFeatures: mocks.enabledFeatures,
  telegramFeatureAllowed: vi.fn(async () => ({ enabled: true, limits: {} })),
  telegramPlatformConfig: () => ({
    enabled: true,
    botToken: "test-token",
    webhookSecret: "test-webhook-secret",
    linkCodeSecret: "test-link-code-secret-that-is-long-enough",
    linkCodeTtlMinutes: 10,
    linkCodeMaxAttempts: 5,
    linkCodeLength: 6,
    allowUserBotTokens: false,
    updateMode: "webhook",
    webhookMaxBytes: 1_048_576,
    publicAppUrl: "https://app.example",
  }),
  unlinkTelegramAccount: vi.fn(async () => ({ unlinked: true })),
  verifyTelegramWebhookSecret: (value: string | null) => value === "test-webhook-secret",
}));

vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: vi.fn(async () => undefined) }));

function request(update: Record<string, unknown>) {
  return new Request("https://app.example/api/webhooks/telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "test-webhook-secret",
    },
    body: JSON.stringify(update),
  });
}

async function flushAfter() {
  const pending = mocks.pending.splice(0);
  await Promise.all(pending);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pending.splice(0);
  mocks.execute.mockResolvedValue({ rows: [{ id: "00000000-0000-4000-8000-000000000001" }] });
  mocks.resolveAccount.mockResolvedValue(null);
  mocks.consumeCode.mockResolvedValue({ ok: true, userId: "user-1", organizationId: "org-1" });
});

afterEach(() => {
  mocks.pending.splice(0);
});

describe("central Telegram command runtime", () => {
  it("handles /start without a link payload with a useful welcome", async () => {
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const response = await POST(request({
      update_id: 1001,
      message: { message_id: 1, text: "/start", chat: { id: 10 }, from: { id: 20 } },
    }));
    expect(response.status).toBe(200);
    await flushAfter();
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "10",
      text: expect.stringContaining("حسابك غير مرتبط"),
    }));
  });

  it("consumes /start link_<code> and sends success plus the command list", async () => {
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    await POST(request({
      update_id: 1002,
      message: { message_id: 2, text: "/start link_123456", chat: { id: 10 }, from: { id: 20 } },
    }));
    await flushAfter();
    expect(mocks.consumeCode).toHaveBeenCalledWith(expect.objectContaining({ code: "123456" }));
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: "تم ربط حسابك بنجاح ✅" }));
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("/agents") }));
  });

  it("answers callback_query and handles the help command", async () => {
    mocks.resolveAccount.mockResolvedValue({
      id: "link-1",
      userId: "user-1",
      organizationId: "org-1",
      telegramUserId: "20",
      telegramChatId: "10",
      status: "active",
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    });
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    await POST(request({
      update_id: 1003,
      callback_query: {
        id: "callback-1",
        data: "telegram.help",
        from: { id: 20 },
        message: { message_id: 3, chat: { id: 10 } },
      },
    }));
    expect(mocks.answerCallback).toHaveBeenCalledWith({ token: "test-token", callbackQueryId: "callback-1" });
    await flushAfter();
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("/status") }));
  });

  it("returns a safe user message when link consumption fails", async () => {
    mocks.consumeCode.mockRejectedValueOnce(new Error("database connection detail must not leak"));
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    await POST(request({
      update_id: 1004,
      message: { message_id: 4, text: "/start link_654321", chat: { id: 10 }, from: { id: 20 } },
    }));
    await flushAfter();
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: "تعذر إكمال الطلب حاليًا. حاول إنشاء رمز جديد أو راجع حالة خدمة Telegram.",
    }));
    expect(JSON.stringify(mocks.sendMessage.mock.calls)).not.toContain("database connection detail");
  });
});
