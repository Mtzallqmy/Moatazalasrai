import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { chatStreamSchema } from "@/lib/http/contracts";

const id = "00000000-0000-4000-8000-000000000001";

describe("full MCP catalog and mobile release", () => {
  it("accepts explicit MCP resources and prompts in chat requests", () => {
    const parsed = chatStreamSchema.parse({
      conversationId: id,
      message: "راجع المشروع",
      mcpResources: [{ serverId: id, uri: "file:///workspace/src/main.ts" }],
      mcpPrompt: {
        serverId: id,
        name: "review-code",
        arguments: { language: "typescript" },
      },
    });
    expect(parsed.mcpResources).toHaveLength(1);
    expect(parsed.mcpPrompt?.name).toBe("review-code");
  });

  it("ships additive catalog and audit tables", async () => {
    const migration = await readFile("drizzle/0012_mcp_full_catalog.sql", "utf8");
    expect(migration).toContain('"mcp_resources"');
    expect(migration).toContain('"mcp_resource_templates"');
    expect(migration).toContain('"mcp_prompts"');
    expect(migration).toContain('"mcp_content_reads"');
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE/i);
  });

  it("discovers and reads every core server primitive", async () => {
    const client = await readFile("src/ai/mcp/client.ts", "utf8");
    expect(client).toContain("listTools");
    expect(client).toContain("listResources");
    expect(client).toContain("listResourceTemplates");
    expect(client).toContain("listPrompts");
    expect(client).toContain("readResource");
    expect(client).toContain("getPrompt");
    expect(client).toContain("resetTimeoutOnProgress");
  });

  it("builds an arm64 app against the production domain", async () => {
    const workflow = await readFile(".github/workflows/android-release.yml", "utf8");
    const config = await readFile("apps/mobile/lib/src/core/api_config.dart", "utf8");
    expect(workflow).toContain("android-arm64");
    expect(workflow).toContain("HAS_RELEASE_KEYSTORE");
    expect(workflow).toContain("https://moatazbot.duckdns.org");
    expect(config).toContain("https://moatazbot.duckdns.org");
  });
});
