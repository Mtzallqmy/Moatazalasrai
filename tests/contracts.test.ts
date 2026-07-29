import { describe, expect, it } from "vitest";
import {
  agentCreateSchema,
  loginSchema,
  providerInputSchema,
  registerSchema,
} from "@/lib/http/contracts";

describe("request contracts", () => {
  it("normalizes login email and rejects unknown fields", () => {
    expect(loginSchema.parse({ email: " USER@Example.COM ", password: "secret" }).email).toBe("user@example.com");
    expect(() => loginSchema.parse({ email: "a@example.com", password: "secret", role: "owner" })).toThrow();
  });

  it("requires a strong registration password", () => {
    expect(() => registerSchema.parse({
      name: "مستخدم",
      email: "user@example.com",
      password: "short",
      organizationName: "المؤسسة",
    })).toThrow();
  });

  it("bounds agent runtime controls", () => {
    expect(() => agentCreateSchema.parse({
      name: "Agent",
      providerCredentialId: crypto.randomUUID(),
      model: "model",
      instructions: "system",
      temperature: 3,
      maxOutputTokens: 2048,
    })).toThrow();
  });

  it("rejects non-URL provider base values", () => {
    expect(() => providerInputSchema.parse({
      provider: "openai_compatible",
      name: "Custom",
      apiKey: "12345678",
      baseUrl: "not-a-url",
    })).toThrow();
  });
});
