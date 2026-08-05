import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  updateWhere: vi.fn(async () => []),
}));

vi.mock("@/db", () => ({
  db: () => ({
    execute: mocks.execute,
    update: () => ({ set: () => ({ where: mocks.updateWhere }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve([]) }) }),
  }),
}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (callback: () => unknown) => { void callback(); } };
});
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: vi.fn(async () => undefined) }));

const keys = [
  "NODE_ENV", "APP_URL", "TELEGRAM_INTEGRATION_ENABLED", "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_LINK_CODE_SECRET", "TELEGRAM_UPDATE_MODE",
] as const;
const original = new Map<string, string | undefined>();

beforeEach(() => {
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
  mocks.updateWhere.mockClear();
  mocks.execute.mockResolvedValue({ rows: [{ id: "00000000-0000-4000-8000-000000000001" }] });
});

afterEach(() => {
  for (const key of keys) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  original.clear();
});

function request(secret?: string) {
  return new Request("https://app.example/api/webhooks/telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}),
    },
    body: JSON.stringify({ update_id: 12345 }),
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

  it("accepts a webhook with the configured secret", async () => {
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const response = await POST(request("telegram-webhook-secret"));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ accepted: true });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("acknowledges a duplicate update without processing it twice", async () => {
    mocks.execute.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "23505" }));
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const response = await POST(request("telegram-webhook-secret"));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ accepted: true, duplicate: true });
  });
});
