import { describe, expect, it } from "vitest";
import {
  assertMcpJsonLimits,
  safeMcpResultRecord,
  validateMcpToolInput,
  validateMcpToolOutput,
} from "@/ai/mcp/validation";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: { query: { type: "string", minLength: 1, maxLength: 100 } },
};

describe("MCP execution boundaries", () => {
  it("accepts valid input and rejects schema bypasses", () => {
    expect(() => validateMcpToolInput(schema, "schema-1", { query: "آمن" })).not.toThrow();
    expect(() => validateMcpToolInput(schema, "schema-1", { query: "x", admin: true }))
      .toThrowError(expect.objectContaining({ code: "MCP_TOOL_ARGUMENTS_INVALID", status: 422 }));
  });

  it("rejects excessive nesting before a remote call", () => {
    let value: unknown = "leaf";
    for (let index = 0; index < 15; index += 1) value = { nested: value };
    expect(() => assertMcpJsonLimits(value))
      .toThrowError(expect.objectContaining({ code: "MCP_PAYLOAD_COMPLEXITY_EXCEEDED", status: 413 }));
  });

  it("fails closed when structured output violates the advertised schema", () => {
    expect(() => validateMcpToolOutput(schema, "schema-2", { query: 42 }))
      .toThrowError(expect.objectContaining({ code: "MCP_TOOL_OUTPUT_INVALID", status: 502 }));
  });

  it("records only metadata and a digest, never raw tool content", () => {
    const record = safeMcpResultRecord({ content: [{ type: "text", text: "secret-value" }], isError: false });
    expect(record.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(record.contentTypes).toEqual(["text"]);
    expect(JSON.stringify(record)).not.toContain("secret-value");
  });
});
