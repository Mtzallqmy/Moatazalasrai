import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "@/lib/config/env";

const connection = {
  id: "00000000-0000-4000-8000-000000000010",
  organizationId: "00000000-0000-4000-8000-000000000011",
  kind: "whatsapp" as const,
  integrationId: null,
  name: "WhatsApp",
  externalAccountId: "1234567890",
  displayAddress: "+967700000000",
  credentialSource: "environment",
  defaultAgentId: null,
  defaultProviderCredentialId: null,
  defaultModel: null,
  inboxId: null,
  workflowId: null,
  settings: {},
  status: "healthy",
  enabled: true,
  webhookStatus: "configured",
  webhookLastVerifiedAt: null,
  lastHealthAt: null,
  lastErrorCode: null,
  createdByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const effectivePolicy = {
  organizationId: connection.organizationId,
  userId: "00000000-0000-4000-8000-000000000012",
  agentId: null,
  providerCredentialId: null,
  modelId: null,
  teamId: null,
  inboxId: null,
  workflowId: null,
  allowedTools: [],
  allowedActions: [],
  permissions: ["ai.chat", "agent.use", "conversation.open"],
  monthlyLimit: null,
  autoReplyEnabled: true,
  humanHandoffEnabled: true,
  memoryEnabled: true,
  filesEnabled: true,
  status: "active" as const,
  forceHumanHandoff: false,
};

const mocks = vi.hoisted(() => ({
  processMessage: vi.fn(async () => undefined),
  routeIncoming: vi.fn(async () => ({ duplicate: false })),
  featureEnabled: vi.fn(async () => true),
  insertReturning: vi.fn(async () => [{ id: "event-id" }]),
  updateWhere: vi.fn(async () => []),
  resolveSender: vi.fn(),
  resolvePolicy: vi.fn(),
  ensureProjection: vi.fn(),
}));

vi.mock("@/lib/integrations/whatsapp/commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/whatsapp/commands")>();
  return { ...actual, processWhatsAppMessage: mocks.processMessage };
});
vi.mock("@/lib/channels/whatsapp-platform", () => ({
  resolveWhatsAppSender: mocks.resolveSender,
  resolveEffectiveWhatsAppPolicy: mocks.resolvePolicy,
  ensureOrganizationWhatsAppProjection: mocks.ensureProjection,
  connectionForWhatsAppPolicy: (value: typeof connection) => value,
  channelPolicyForWhatsApp: () => ({
    settings: {},
    permissions: new Set(["ai.chat", "agent.use", "conversation.open"]),
    blockedOperations: new Set(["financial", "sensitive"]),
    allowedCommands: new Set(),
    allowedToolIds: [],
  }),
  withWhatsAppChannelPolicy: (_input: unknown, callback: () => Promise<unknown>) => callback(),
}));
vi.mock("@/lib/channels/router", () => ({ routeIncomingChannelMessage: mocks.routeIncoming }));
vi.mock("@/lib/control-plane/features", () => ({ isFeatureEnabled: mocks.featureEnabled }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: vi.fn(async () => undefined) }));
vi.mock("@/db", () => ({
  db: () => ({
    insert: () => ({ values: () => ({ returning: mocks.insertReturning }) }),
    update: () => ({ set: () => ({ where: mocks.updateWhere }) }),
  }),
}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (callback: () => unknown) => { void callback(); } };
});

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
  for (const mock of Object.values(mocks)) mock.mockClear();
  mocks.featureEnabled.mockResolvedValue(true);
  mocks.routeIncoming.mockResolvedValue({ duplicate: false });
  mocks.insertReturning.mockResolvedValue([{ id: "event-id" }]);
  mocks.resolveSender.mockResolvedValue({ organizationId: connection.organizationId, userId: effectivePolicy.userId, linked: true });
  mocks.resolvePolicy.mockResolvedValue(effectivePolicy);
  mocks.ensureProjection.mockResolvedValue(connection);
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

describe("WhatsApp webhook route", () => {
  it("returns the Meta challenge only for the configured verify token", async () => {
    const { GET } = await import("@/app/api/webhooks/whatsapp/route");
    const valid = await GET(new Request("https://app.example/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token-123456&hub.challenge=challenge-1"));
    expect(valid.status).toBe(200);
    expect(await valid.text()).toBe("challenge-1");
    const invalid = await GET(new Request("https://app.example/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong-token-value&hub.challenge=challenge-2"));
    expect(invalid.status).toBe(403);
  });

  it("routes ordinary messages through the channel platform and handles commands separately", async () => {
    const { POST } = await import("@/app/api/webhooks/whatsapp/route");
    const raw = JSON.stringify({ entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "1234567890" },
      messages: [
        { id: "wamid.1", from: "967711111111", type: "text", text: { body: "لخص آخر محادثة" } },
        { id: "wamid.2", from: "967722222222", type: "interactive", interactive: { button_reply: { id: "wa.account" } } },
      ],
    } }] }] });
    const signature = `sha256=${createHmac("sha256", process.env.META_APP_SECRET!).update(raw).digest("hex")}`;
    const response = await POST(new Request("https://app.example/api/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body: raw }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ legacyCommands: 1, channelMessages: 1 });
    expect(mocks.insertReturning).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mocks.processMessage).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(mocks.routeIncoming).toHaveBeenCalledTimes(1));
  });

  it("acknowledges status-only events without scheduling message processing", async () => {
    const { POST } = await import("@/app/api/webhooks/whatsapp/route");
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "1234567890" }, statuses: [{ id: "wamid.status" }] } }] }] });
    const signature = `sha256=${createHmac("sha256", process.env.META_APP_SECRET!).update(raw).digest("hex")}`;
    const response = await POST(new Request("https://app.example/api/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body: raw }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ messages: 0, duplicates: 0 });
    expect(mocks.processMessage).not.toHaveBeenCalled();
    expect(mocks.routeIncoming).not.toHaveBeenCalled();
  });

  it("delegates repeated ordinary message IDs to the idempotent channel router", async () => {
    mocks.routeIncoming.mockResolvedValueOnce({ duplicate: true });
    const { POST } = await import("@/app/api/webhooks/whatsapp/route");
    const raw = JSON.stringify({ entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "1234567890" },
      messages: [{ id: "wamid.duplicate", from: "967711111111", type: "text", text: { body: "اكتب تقريرًا قصيرًا" } }],
    } }] }] });
    const signature = `sha256=${createHmac("sha256", process.env.META_APP_SECRET!).update(raw).digest("hex")}`;
    const response = await POST(new Request("https://app.example/api/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body: raw }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ messages: 1, channelMessages: 1 });
    await vi.waitFor(() => expect(mocks.routeIncoming).toHaveBeenCalledTimes(1));
  });

  it("rejects a POST with an invalid signature before database processing", async () => {
    const { POST } = await import("@/app/api/webhooks/whatsapp/route");
    const response = await POST(new Request("https://app.example/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${"0".repeat(64)}` },
      body: JSON.stringify({ entry: [] }),
    }));
    expect(response.status).toBe(401);
    expect(mocks.insertReturning).not.toHaveBeenCalled();
    expect(mocks.routeIncoming).not.toHaveBeenCalled();
  });
});
