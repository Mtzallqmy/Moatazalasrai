import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertSameOrigin, getRequestId, parseJson } from "@/lib/http/api";

describe("HTTP safety helpers", () => {
  it("does not trust malformed request IDs", () => {
    const request = new Request("https://app.example.com", { headers: { "x-request-id": "bad value" } });
    expect(getRequestId(request)).not.toBe("bad value");
  });

  it("rejects cross-origin cookie mutations", () => {
    const request = new Request("https://app.example.com/api/action", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(() => assertSameOrigin(request)).toThrow();
  });

  it("enforces JSON body size and shape", async () => {
    const request = new Request("https://app.example.com/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "ok" }),
    });
    await expect(parseJson(request, z.object({ value: z.literal("ok") }).strict())).resolves.toEqual({ value: "ok" });
  });
});
