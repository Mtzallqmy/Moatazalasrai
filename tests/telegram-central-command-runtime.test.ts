import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  answerCallback: vi.fn(async () => true),
  enqueue: vi.fn(async () => ({ jobId: "job-1" })),
}));

vi.mock("@/db", () => ({
  db: () => ({ execute: mocks.execute }),
}));

vi.mock("@/lib/integrations/telegram", () => ({
  answerTelegramCallback: mocks.answerCallback,
}));

vi.mock("@/lib/integrations/telegram-platform", () => ({
  telegramPlatformConfig: () => ({
    enabled: true,
    botToken: "test-token",
    webhookSecret: "test-webhook-secret",
    webhookMaxBytes: 1_048_576,
  }),
  verifyTelegramWebhookSecret: (value: string | null) => value === "test-webhook-secret",
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => undefined),
}));

vi.mock("@/worker/queue", () => ({
  enqueueTelegramCentralUpdate: mocks.enqueue,
}));

function request(update: Record<string, unknown>, secret = "test-webhook-secret") {
  return new Request("https://app.example/api/webhooks/telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
    },
    body: JSON.stringify(update),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue({
    rows: [{ id: "00000000-0000-4000-8000-000000000001", status: "accepted" }],
  });
});

describe("central Telegram webhook runtime", () => {
  it("persists and queues /start without doing heavy processing in the webhook", async () => {
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const update = {
      update_id: 1001,
      message: { message_id: 1, text: "/start", chat: { id: 10 }, from: { id: 20 } },
    };
    const response = await POST(request(update));
    expect(response.status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledWith({
      updateRowId: "00000000-0000-4000-8000-000000000001",
      update,
    });
  });

  it("queues /start link_<code> without exposing or consuming the code in the webhook", async () => {
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const update = {
      update_id: 1002,
      message: { message_id: 2, text: "/start link_123456", chat: { id: 10 }, from: { id: 20 } },
    };
    const response = await POST(request(update));
    expect(response.status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ update }));
  });

  it("answers callback_query immediately and then queues it", async () => {
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const update = {
      update_id: 1003,
      callback_query: {
        id: "callback-1",
        data: "cc.agents:1",
        from: { id: 20 },
        message: { message_id: 3, chat: { id: 10 } },
      },
    };
    const response = await POST(request(update));
    expect(response.status).toBe(200);
    expect(mocks.answerCallback).toHaveBeenCalledWith({ token: "test-token", callbackQueryId: "callback-1" });
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ update }));
  });

  it("does not queue an update already completed", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "00000000-0000-4000-8000-000000000001", status: "completed" }] });
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const response = await POST(request({
      update_id: 1004,
      message: { message_id: 4, text: "/start", chat: { id: 10 }, from: { id: 20 } },
    }));
    expect(response.status).toBe(200);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("rejects an invalid webhook secret before database access", async () => {
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const response = await POST(request({ update_id: 1005 }, "wrong-secret"));
    expect(response.status).toBe(401);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
