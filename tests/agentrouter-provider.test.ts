import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  AGENTROUTER_OPENAI_BASE_URL,
  canonicalizeProviderBaseUrl,
} from "@/lib/providers/base-url";

describe("AgentRouter OpenAI-compatible setup", () => {
  it("repairs only the documented AgentRouter host aliases", () => {
    expect(canonicalizeProviderBaseUrl("openai_compatible", "https://agentrouter.org/v1"))
      .toBe(AGENTROUTER_OPENAI_BASE_URL);
    expect(canonicalizeProviderBaseUrl("openai_compatible", "https://www.agentrouter.org"))
      .toBe(AGENTROUTER_OPENAI_BASE_URL);
    expect(canonicalizeProviderBaseUrl("openai_compatible", "https://co.agentrouter.org/v1/"))
      .toBe(AGENTROUTER_OPENAI_BASE_URL);
  });

  it("does not rewrite arbitrary or suspicious provider URLs", () => {
    expect(canonicalizeProviderBaseUrl("openai_compatible", "https://provider.example/v1"))
      .toBe("https://provider.example/v1");
    expect(canonicalizeProviderBaseUrl("openai_compatible", "https://agentrouter.org/other"))
      .toBe("https://agentrouter.org/other");
    expect(canonicalizeProviderBaseUrl("openai_compatible", "https://agentrouter.org/v1?target=elsewhere"))
      .toBe("https://agentrouter.org/v1?target=elsewhere");
    expect(canonicalizeProviderBaseUrl("openai", "https://agentrouter.org/v1"))
      .toBe("https://agentrouter.org/v1");
  });

  it("keeps bearer-token redirects disabled and requires discovery before saving", async () => {
    const [http, form] = await Promise.all([
      readFile("src/lib/providers/http.ts", "utf8"),
      readFile("src/components/provider-form.tsx", "utf8"),
    ]);
    expect(http).toContain('redirect: "error"');
    expect(form).toContain('changePreset("agentrouter")');
    expect(form).toContain("disabled={!canSave}");
    expect(form).toContain("افحص الاتصال واجلب النماذج أولًا");
    expect(form).toContain('requestValidation(form, "verify", testModel)');
  });

  it("ships a non-destructive migration that never touches provider secrets", async () => {
    const migration = await readFile("drizzle/0014_agentrouter_base_url.sql", "utf8");
    expect(migration).toContain("https://co.agentrouter.org/v1");
    expect(migration).toContain("https://agentrouter.org/v1");
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|encrypted_secret/i);
  });
});
