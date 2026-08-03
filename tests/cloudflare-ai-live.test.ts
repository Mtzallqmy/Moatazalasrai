import { describe, expect, test } from "vitest";
import { runCloudflareRestChat } from "@/lib/providers/cloudflare-rest";

const enabled = process.env.CLOUDFLARE_AI_LIVE_TEST?.trim().toLowerCase() === "true";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID?.trim();
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
const model = process.env.CLOUDFLARE_AI_LIVE_MODEL?.trim();
const describeLive = enabled && accountId && gatewayId && apiToken && model ? describe : describe.skip;

describeLive("Cloudflare AI Gateway live integration", () => {
  test("returns a real non-empty response using dedicated staging credentials", async () => {
    const result = await runCloudflareRestChat({
      accountId,
      gatewayId,
      model: model!,
      messages: [{ role: "user", content: "Reply with exactly OK." }],
      temperature: 0,
      maxOutputTokens: 8,
      skipCache: true,
      collectLog: false,
      requestId: crypto.randomUUID(),
    });
    expect(result.text.trim().length).toBeGreaterThan(0);
  }, 120_000);
});
