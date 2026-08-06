import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capabilityVisible: vi.fn(),
  capabilityHandler: vi.fn(async () => undefined),
  sendError: vi.fn(async () => undefined),
  sendText: vi.fn(async () => undefined),
  answerMessage: vi.fn(async () => undefined),
  touchInteraction: vi.fn(async () => undefined),
  connectedUser: vi.fn(),
  resolvePolicy: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ role: "admin" }] }),
      }),
    }),
  }),
}));
vi.mock("@/lib/auth/custom-permissions", () => ({ loadCustomPermissions: vi.fn(async () => []) }));
vi.mock("@/lib/auth/permissions", () => ({ permissionsFor: vi.fn(() => ["agents:manage", "channels:use"]) }));
vi.mock("@/lib/channels/whatsapp-platform", () => ({ resolveEffectiveWhatsAppPolicy: mocks.resolvePolicy }));
vi.mock("@/lib/integrations/whatsapp/config", () => ({
  requireWhatsAppConfig: () => ({ publicAppUrl: "https://app.example" }),
}));
vi.mock("@/lib/integrations/whatsapp/linking", () => ({
  connectedWhatsAppUser: mocks.connectedUser,
  consumeWhatsAppConnectToken: vi.fn(),
  parseConnectToken: vi.fn(() => null),
  touchWhatsAppInteraction: mocks.touchInteraction,
}));
vi.mock("@/lib/whatsapp/capability-registry", () => ({
  capabilityVisible: mocks.capabilityVisible,
  whatsappCapability: vi.fn((id: string) => ({
    id,
    handler: mocks.capabilityHandler,
  })),
}));
vi.mock("@/lib/whatsapp/agent-flows", () => ({
  handleWhatsAppAgentCreationInput: vi.fn(),
  listWhatsAppAgents: vi.fn(),
  showWhatsAppAgent: vi.fn(),
}));
vi.mock("@/lib/whatsapp/account-flows", () => ({ confirmWhatsAppDisconnect: vi.fn() }));
vi.mock("@/lib/whatsapp/conversation-flows", () => ({
  activateWhatsAppChatAgent: vi.fn(),
  chooseWhatsAppAgent: vi.fn(),
  continueWhatsAppChat: vi.fn(),
  listWhatsAppConversations: vi.fn(),
  showWhatsAppConversation: vi.fn(),
  startNewWhatsAppConversation: vi.fn(),
}));
vi.mock("@/lib/whatsapp/menu-renderer", () => ({
  sendWhatsAppMainMenu: vi.fn(),
  sendWhatsAppSectionMenu: vi.fn(),
}));
vi.mock("@/lib/whatsapp/message-renderer", () => ({
  answerWhatsAppMessage: mocks.answerMessage,
  sendWhatsAppError: mocks.sendError,
  sendWhatsAppText: mocks.sendText,
}));
vi.mock("@/lib/whatsapp/session-service", () => ({
  cancelWhatsAppFlow: vi.fn(),
  getOrCreateWhatsAppSession: mocks.getSession,
}));

const policy = {
  permissions: ["agent.use", "account.read"],
};
const session = {
  id: "00000000-0000-4000-8000-000000000020",
  userId: "00000000-0000-4000-8000-000000000012",
  organizationId: "00000000-0000-4000-8000-000000000011",
  whatsappWaId: "967711111111",
  activeFlow: null,
  currentStep: null,
  selectedAgentId: null,
  selectedTeamId: null,
  selectedConversationId: null,
  state: {},
  version: 1,
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectedUser.mockResolvedValue({
    connectionId: "link-1",
    userId: session.userId,
    organizationId: session.organizationId,
    name: "Admin",
    email: "admin@example.test",
  });
  mocks.resolvePolicy.mockResolvedValue(policy);
  mocks.getSession.mockResolvedValue(session);
  mocks.capabilityVisible.mockResolvedValue(false);
});

describe("WhatsApp capability execution guard", () => {
  it("blocks a forged agents.create action even when the caller manually sends its stable ID", async () => {
    const { processWhatsAppUpdate } = await import("@/lib/whatsapp/update-processor");
    const result = await processWhatsAppUpdate({
      requestId: "request-1",
      message: {
        id: "wamid.forged",
        from: "967711111111",
        type: "interactive",
        interactive: { button_reply: { id: "wa.agents.create", title: "إنشاء وكيل" } },
      },
    });

    expect(result.handled).toBe(true);
    expect(mocks.capabilityVisible).toHaveBeenCalledTimes(1);
    expect(mocks.capabilityHandler).not.toHaveBeenCalled();
    expect(mocks.sendError).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("غير متاحة"),
    }));
  });

  it("rechecks permission on an already active multi-step agent flow", async () => {
    mocks.getSession.mockResolvedValue({ ...session, activeFlow: "agent.create", currentStep: "name" });
    const { processWhatsAppUpdate } = await import("@/lib/whatsapp/update-processor");
    await processWhatsAppUpdate({
      requestId: "request-2",
      message: {
        id: "wamid.flow",
        from: "967711111111",
        type: "text",
        text: { body: "مساعد المحتوى" },
      },
    });

    expect(mocks.capabilityVisible).toHaveBeenCalledTimes(1);
    expect(mocks.capabilityHandler).not.toHaveBeenCalled();
    expect(mocks.sendError).toHaveBeenCalled();
  });
});
