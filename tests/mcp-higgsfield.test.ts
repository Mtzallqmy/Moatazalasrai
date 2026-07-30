import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_URL,
  HIGGSFIELD_MCP_ENDPOINT,
  isOfficialHiggsfieldEndpoint,
} from "@/ai/mcp/oauth";
import { classifyMcpTool } from "@/ai/mcp/tools";

describe("Higgsfield MCP integration", () => {
  it("pins OAuth to the official Streamable HTTP endpoint", () => {
    expect(HIGGSFIELD_MCP_ENDPOINT).toBe("https://mcp.higgsfield.ai/mcp");
    expect(DEFAULT_APP_URL).toBe("https://moatazbot.duckdns.org");
    expect(isOfficialHiggsfieldEndpoint(HIGGSFIELD_MCP_ENDPOINT)).toBe(true);
    expect(isOfficialHiggsfieldEndpoint("https://mcp.higgsfield.ai.evil.test/mcp")).toBe(false);
    expect(isOfficialHiggsfieldEndpoint("http://mcp.higgsfield.ai/mcp")).toBe(false);
  });

  it("registers image and video generators as media capabilities", () => {
    expect(classifyMcpTool({
      name: "generate_video",
      description: "Create cinematic motion clips from an image",
    })).toEqual({ capability: "video_generation", mediaType: "video" });
    expect(classifyMcpTool({
      name: "text_to_image",
      description: "Render a new photo from a prompt",
    })).toEqual({ capability: "image_generation", mediaType: "image" });
  });

  it("ships an additive OAuth and media registry migration", async () => {
    const migration = await readFile("drizzle/0011_higgsfield_oauth_media_tools.sql", "utf8");
    expect(migration).toContain('"encrypted_oauth_data"');
    expect(migration).toContain('"capability"');
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE/i);
  });
});
