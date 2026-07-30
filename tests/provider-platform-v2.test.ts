import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { providerInputSchema, providerUpdateSchema } from "@/lib/http/contracts";
import { getProviderPreset, providerPresets } from "@/lib/providers/catalog";
import { getProviderAdapter, inferProviderSlug } from "@/lib/providers/registry";

const id = "00000000-0000-4000-8000-000000000001";

describe("provider platform v2", () => {
  it("ships verified presets for major native, cloud, router and inference APIs", () => {
    const expected = {
      openai: "https://api.openai.com/v1",
      anthropic: "https://api.anthropic.com",
      "google-gemini": "https://generativelanguage.googleapis.com/v1beta",
      "google-gemini-openai": "https://generativelanguage.googleapis.com/v1beta/openai",
      openrouter: "https://openrouter.ai/api/v1",
      huggingface: "https://router.huggingface.co/v1",
      groq: "https://api.groq.com/openai/v1",
      together: "https://api.together.ai/v1",
      "nvidia-nim": "https://integrate.api.nvidia.com/v1",
      fireworks: "https://api.fireworks.ai/inference/v1",
      deepinfra: "https://api.deepinfra.com/v1/openai",
      mistral: "https://api.mistral.ai/v1",
      deepseek: "https://api.deepseek.com",
      xai: "https://api.x.ai/v1",
      "perplexity-sonar": "https://api.perplexity.ai",
      "perplexity-agent": "https://api.perplexity.ai/v1",
      cerebras: "https://api.cerebras.ai/v1",
      sambanova: "https://api.sambanova.ai/v1",
      agentrouter: "https://co.agentrouter.org/v1",
    } as const;
    for (const [slug, endpoint] of Object.entries(expected)) {
      expect(getProviderPreset(slug)?.defaultBaseUrl).toBe(endpoint);
    }
    expect(providerPresets.some((preset) => preset.slug === "custom-openai-compatible")).toBe(true);
  });

  it("selects Responses and Chat Completions bridges from the connection profile", () => {
    expect(getProviderAdapter("openai_compatible", "xai").kind).toBe("openai");
    expect(getProviderAdapter("openai_compatible", "aws-bedrock-mantle").kind).toBe("openai");
    expect(getProviderAdapter("openai_compatible", "openrouter").kind).toBe("openai_compatible");
    expect(inferProviderSlug("openai_compatible", "https://bedrock-mantle.eu-west-1.api.aws/v1"))
      .toBe("aws-bedrock-mantle");
  });

  it("accepts provider presets and manual model validation in create and update contracts", () => {
    expect(providerInputSchema.parse({
      provider: "openai_compatible",
      providerSlug: "huggingface",
      name: "HF",
      apiKey: "hf_123456789",
      manualModel: "meta-llama/model",
    }).providerSlug).toBe("huggingface");
    expect(providerUpdateSchema.parse({
      id,
      providerSlug: "nvidia-nim",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      revalidate: true,
      testModel: "meta/model",
    }).revalidate).toBe(true);
  });

  it("uses additive soft deletion and preserves historical agent versions", async () => {
    const [migration, dashboardRoute, apiRoute] = await Promise.all([
      readFile("drizzle/0014_provider_catalog_soft_delete.sql", "utf8"),
      readFile("src/app/api/dashboard/providers/route.ts", "utf8"),
      readFile("src/app/api/v1/provider-credentials/route.ts", "utf8"),
    ]);
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "deleted_at"');
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE/i);
    expect(dashboardRoute).toContain('"deleted_at" IS NULL');
    expect(dashboardRoute).toContain('"deleted_at" =');
    expect(dashboardRoute).not.toContain("PROVIDER_IN_USE");
    expect(apiRoute).toContain("export async function PATCH");
    expect(apiRoute).toContain("export async function DELETE");
  });

  it("honors provider and model selection in both dashboard and public API chat", async () => {
    const [dashboardChat, apiChat] = await Promise.all([
      readFile("src/components/chat-console.tsx", "utf8"),
      readFile("src/app/api/v1/chat/route.ts", "utf8"),
    ]);
    expect(dashboardChat).toContain("providerCredentialId");
    expect(dashboardChat).toContain("selectedModel");
    expect(apiChat).toContain("providerCredentialId: body.providerCredentialId");
    expect(apiChat).toContain("model: body.model");
  });
});
