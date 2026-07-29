import { describe, expect, it } from "vitest";
import { agentTemplates, getAgentTemplate } from "@/lib/agents/templates";

describe("production agent library", () => {
  it("ships distinct, actionable templates without unsafe promises", () => {
    expect(agentTemplates.length).toBeGreaterThanOrEqual(8);
    expect(new Set(agentTemplates.map((template) => template.id)).size).toBe(agentTemplates.length);
    for (const template of agentTemplates) {
      expect(template.name.length).toBeGreaterThan(3);
      expect(template.instructions.length).toBeGreaterThan(150);
      expect(template.maxOutputTokens).toBeGreaterThanOrEqual(2048);
      expect(template.instructions).not.toMatch(/نفذت|تم النشر بنجاح/);
    }
  });

  it("resolves templates only from the allowlisted catalog", () => {
    expect(getAgentTemplate("code-engineer")?.category).toBe("coding");
    expect(getAgentTemplate("shell-root")).toBeUndefined();
  });
});
