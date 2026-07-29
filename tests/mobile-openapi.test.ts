import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/v1/openapi/route";

describe("mobile and agent team OpenAPI contract", () => {
  it("publishes native login, refresh, teams, and scoped bearer authentication", async () => {
    const response = GET();
    const document = await response.json();
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/api/mobile/v1/auth/login"].post.security).toEqual([]);
    expect(document.paths["/api/mobile/v1/auth/refresh"].post.security).toEqual([]);
    expect(document.paths["/api/mobile/v1/me"].get.operationId).toBe("mobileMe");
    expect(document.paths["/api/v1/team-runs"].post.parameters[0].name).toBe("Idempotency-Key");
    expect(document.components.securitySchemes.bearerAuth.bearerFormat).toContain("mat_");
  });

  it("keeps chat bound to a conversation instead of trusting a client-supplied agent", async () => {
    const document = await GET().json();
    const chat = document.components.schemas.ChatInput;
    expect(chat.required).toEqual(["conversationId", "message"]);
    expect(chat.properties.agentId).toBeUndefined();
  });
});
