import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  enqueue: vi.fn(async () => ({ jobId: "job-1" })),
  answerCallback: vi.fn(async () => true),
}));

vi.mock("@/db", () => ({
  db: () => ({ execute: mocks.execute }),
}));
vi.mock("@/worker/queue", () => ({ enqueueTelegramUpdate: mocks.enqueue }));
vi.mock("@/lib/telegram/message-renderer", () => ({ answerTelegramCallback: mocks.answerCallback }));

const keys = [
  "NODE_ENV", "APP_URL", "TELEGRAM_INTEGRATION_ENABLED", "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_LINK_CODE_SECRET", "TELEGRAM_UPDATE_MODE",
] as const;
const original = new Map<string, string | undefined>();
const updateRowId = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.resetModules();
  for (const key of keys) original.set(key, process.env[key]);
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_URL: "https://app.example",
    TELEGRAM_INTEGRATION_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: "123456789:test-token",
    TELEGRAM_WEBHOOK_SECRET: "telegram-webhook-secret",
    TELEGRAM_LINK_CODE_SECRET: "telegram-link-code-secret-at-least-32-characters",
    TELEGRAM_UPDATE_MODE: "webhook",
  });
  mocks.execute.mockReset();
  mocks.enqueue.mockReset();
  mocks.enqueue.mockResolvedValue({ jobId: "job-1" });
  mocks.answerCallback.mockClear();
  mocks.execute.mockResolvedValue({ rows: [{ id: updateRowId, status: "accepted", error_code: null }] });
});

afterEach(() => {
  for (const key of keys) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else Reflect.set(process.env, key, value);
  }
  original.clear();
});

function request(secret?: string, update: Record<string, unknown> = {
  update_id: 12345,
  message: { message_id: 1, text: "/start", chat: { id: 10 }, from: { id: 20 } },
}) {
  return new Request("https://app.example/api/webhooks/telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}),
    },
    body: JSON.stringify(update),
  });
}

describe("central Telegram webhook", () => {
  it("rejects a webhook without the secret", async () => {
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("rejects a webhook with a wrong secret", async () => {
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const response = await POST(request("wrong-secret-value"));
    expect(response.status).toBe(401);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("persists and queues a valid update with the configured secret", async () => {
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const response = await POST(request("telegram-webhook-secret"));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ accepted: true, queued: true, recovered: false });
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ updateId: 12345, updateRowId }));
    expect(mocks.execute.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("queues callback queries without blocking the webhook on an outbound Telegram call", async () => {
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const response = await POST(request("telegram-webhook-secret", {
      update_id: 12346,
      callback_query: {
        id: "callback-1",
        data: "nav:home",
        from: { id: 20 },
        message: { message_id: 2, chat: { id: 10 } },
      },
    }));
    expect(response.status).toBe(200);
    expect(mocks.answerCallback).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });

  it("acknowledges a completed duplicate without queueing it twice", async () => {
    let calls = 0;
    mocks.execute.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return { rows: [] };
      return { rows: [{ id: updateRowId, status: "completed", error_code: null }] };
    });
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const response = await POST(request("telegram-webhook-secret"));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ accepted: true, duplicate: true, terminal: true });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("re-enqueues an accepted duplicate after a previous queue outage", async () => {
    let calls = 0;
    mocks.execute.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return { rows: [] };
      if (calls === 2) return { rows: [{ id: updateRowId, status: "accepted", error_code: "TELEGRAM_QUEUE_UNAVAILABLE" }] };
      return { rows: [] };
    });
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const response = await POST(request("telegram-webhook-secret"));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ accepted: true, queued: true, recovered: true });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });

  it("returns 503 and preserves retryability when Graphile enqueue fails", async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error("queue unavailable"));
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const response = await POST(request("telegram-webhook-secret"));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });
});
