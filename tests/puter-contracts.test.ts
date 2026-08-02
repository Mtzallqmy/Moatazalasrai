import { describe, expect, it } from "vitest";
import { puterChatFinishSchema, puterChatStartSchema } from "@/lib/puter/contracts";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("Puter persistence contracts", () => {
  it("limits prompt and response sizes", () => {
    expect(() => puterChatStartSchema.parse({ conversationId: uuid, message: "x".repeat(12_001), model: "m", clientRequestId: uuid })).toThrow();
    expect(() => puterChatFinishSchema.parse({ conversationId: uuid, executionId: uuid, userMessageId: uuid, model: "m", status: "completed", content: "x".repeat(64_001) })).toThrow();
  });

  it("requires content only for completed responses", () => {
    expect(() => puterChatFinishSchema.parse({ conversationId: uuid, executionId: uuid, userMessageId: uuid, model: "m", status: "completed" })).toThrow();
    expect(() => puterChatFinishSchema.parse({ conversationId: uuid, executionId: uuid, userMessageId: uuid, model: "m", status: "cancelled", content: "unexpected" })).toThrow();
  });
});
