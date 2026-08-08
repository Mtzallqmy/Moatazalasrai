import { describe, expect, it } from "vitest";
import { redactRunEventPayload } from "@/lib/runs/redaction";

describe("run event redaction", () => {
  it("redacts sensitive keys recursively without discarding safe diagnostics", () => {
    const result = redactRunEventPayload({
      tool: "web_search",
      nested: {
        authorization: "Bearer secret",
        request: { apiKey: "hidden", query: "safe" },
      },
      items: [{ password: "hidden", status: "ok" }],
    });

    expect(result.tool).toBe("web_search");
    expect(result).toMatchObject({
      nested: {
        authorization: "[redacted]",
        request: { apiKey: "[redacted]", query: "safe" },
      },
      items: [{ password: "[redacted]", status: "ok" }],
    });
  });
});
