import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "@/lib/config/env";

const mocks = vi.hoisted(() => ({
  insertReturning: vi.fn(),
  selectLimit: vi.fn(),
  updateWhere: vi.fn(async () => []),
  enqueue: vi.fn(async () => ({ jobId: "job-1" })),
}));

vi.mock("@/db", () => ({
  db: () => ({
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: mocks.insertReturning }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: mocks.selectLimit }),
      }),
    }),
    update: () => ({ set: () => ({ where: mocks.updateWhere }) }),
  }),
}));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: vi.fn(async () => undefined) }));
vi.mock("@/lib/platform/runtime-hydration", () => ({ hydrateRuntimeForRequest: vi.fn(async () => undefined) }));
vi.mock("@/worker/queue", () => ({ enqueueWhatsAppChannelUpdate: mocks.enqueue }));

const managed = [
  "NODE_ENV", "DATABASE_URL", "CREDENTIAL_ENCRYPTION_KEY", "APP_URL", "PUBLIC_APP_URL",
  "WHATSAPP_INTEGRATION_ENABLED", "META_APP_ID", "META_APP_SECRET", "META_GRAPH_API_VERSION",
  "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_DISPLAY_PHONE_NUMBER", "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "WHATSAPP_CONNECT_TOKEN_SECRET",
  "WHATSAPP_CONNECT_TOKEN_TTL_MINUTES",
] as const;
const original = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of managed) original.set(key, process.env[key]);
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://user:pass@example.test/db",
    CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    APP_URL: "https://app.example",
    PUBLIC_APP_URL: "https://app.example",
    WHATSAPP_INTEGRATION_ENABLED: "true",
    META_APP_ID: "123456",
    META_APP_SECRET: "0123456789abcdef0123456789abcdef",
    META_GRAPH_API_VERSION: "v23.0",
    WHATSAPP_ACCESS_TOKEN: "test-access-token-that-is-long-enough",
    WHATSAPP_PHONE_NUMBER_ID: "1234567890",
    WHATSAPP_BUSINESS_ACCOUNT_ID: "9876543210",
    WHATSAPP_DISPLAY_PHONE_NUMBER: "+967 700 000 000",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token-123456",
    WHATSAPP_CONNECT_TOKEN_SECRET: "connect-token-secret-32-characters-minimum",
    WHATSAPP_CONNECT_TOKEN_TTL_MINUTES: "10",
  });
  resetEnvForTests();
  vi.clearAllMocks();
  mocks.insertReturning.mockResolvedValue([{ id: "event-id", status: "accepted", errorCode: null }]);
  mocks.selectLimit.mockResolvedValue([]);
  mocks.enqueue.mockResolvedValue({ jobId: "job-1" });
});

afterEach(() => {
  for (const key of managed) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else Reflect.set(process.env, key, value);
  }
  original.clear();
  resetEnvForTests();
});

function signedRequest(raw: string, signature?: string) {
  const value = signature ?? `sha256=${createHmac("sha256", process.env.META_APP_SECRET!).update(raw).digest("hex")}`;
  return new Request("https://app.example/api/webhooks/whatsapp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": value },
    body: raw,
  });
}

describe("WhatsApp webhook route", () => {
  it("returns the Meta challenge only for the configured verify token", async () => {
    const { GET } = await import("@/app/api/webhooks/whatsapp/route");
    const valid = await GET(new Request("https://app.example/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token-123456&hub.challenge=challenge-1"));
    expect(valid.status).toBe(200);
    expect(await valid.text()).toBe("challenge-1");
    const invalid = await GET(new Request("https://app.example/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong-token-value&hub.challenge=challenge-2"));
    expect(invalid.status).toBe(403);
  });

  it("persists and queues every ordinary or interactive message without heavy processing", async () => {
    const { POST } = await import("@/app/api/webhooks/whatsapp/route");
    const messages = [
      { id: "wamid.1", from: "967711111111", type: "text", text: { body: "لخص آخر محادثة" } },
      { id: "wamid.2", from: "967722222222", type: "interactive", interactive: { button_reply: { id: "cc.account" } } },
    ];
    const raw = JSON.stringify({ entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "1234567890" },
      messages,
    } }] }] });
    const response = await POST(signedRequest(raw));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ messages: 2, queued: 2, failed: 0 });
    expect(mocks.insertReturning).toHaveBeenCalledTimes(2);
    expect(mocks.enqueue).toHaveBeenNthCalledWith(1, { eventRowId: "event-id", message: messages[0] });
    expect(mocks.enqueue).toHaveBeenNthCalledWith(2, { eventRowId: "event-id", message: messages[1] });
  });

  it("acknowledges status-only events without scheduling processing", async () => {
    const { POST } = await import("@/app/api/webhooks/whatsapp/route");
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "1234567890" }, statuses: [{ id: "wamid.status" }] } }] }] });
    const response = await POST(signedRequest(raw));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ messages: 0, queued: 0, duplicates: 0 });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("does not queue an event already completed", async () => {
    mocks.insertReturning.mockResolvedValueOnce([]);
    mocks.selectLimit.mockResolvedValueOnce([{ id: "event-id", status: "completed", errorCode: null }]);
    const { POST } = await import("@/app/api/webhooks/whatsapp/route");
    const raw = JSON.stringify({ entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "1234567890" },
      messages: [{ id: "wamid.duplicate", from: "967711111111", type: "text", text: { body: "رسالة" } }],
    } }] }] });
    const response = await POST(signedRequest(raw));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ messages: 1, queued: 0, duplicates: 1 });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("re-enqueues a duplicate that previously failed only at the queue boundary", async () => {
    mocks.insertReturning.mockResolvedValueOnce([]);
    mocks.selectLimit.mockResolvedValueOnce([{ id: "event-id", status: "accepted", errorCode: "WHATSAPP_QUEUE_UNAVAILABLE" }]);
    const { POST } = await import("@/app/api/webhooks/whatsapp/route");
    const message = { id: "wamid.retry", from: "967711111111", type: "text", text: { body: "أعد المحاولة" } };
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "1234567890" }, messages: [message] } }] }] });
    const response = await POST(signedRequest(raw));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ messages: 1, queued: 1, failed: 0 });
    expect(mocks.enqueue).toHaveBeenCalledWith({ eventRowId: "event-id", message });
  });

  it("returns 503 for a partial batch enqueue failure so Meta retries only the non-terminal rows", async () => {
    mocks.enqueue.mockResolvedValueOnce({ jobId: "job-1" }).mockRejectedValueOnce(new Error("queue down"));
    const { POST } = await import("@/app/api/webhooks/whatsapp/route");
    const messages = [
      { id: "wamid.ok", from: "967711111111", type: "text", text: { body: "الأولى" } },
      { id: "wamid.fail", from: "967722222222", type: "text", text: { body: "الثانية" } },
    ];
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "1234567890" }, messages } }] }] });
    const response = await POST(signedRequest(raw));
    expect(response.status).toBe(503);
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
    expect(mocks.updateWhere).toHaveBeenCalled();
  });

  it("rejects an invalid signature before database processing", async () => {
    const { POST } = await import("@/app/api/webhooks/whatsapp/route");
    const response = await POST(signedRequest(JSON.stringify({ entry: [] }), `sha256=${"0".repeat(64)}`));
    expect(response.status).toBe(401);
    expect(mocks.insertReturning).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
