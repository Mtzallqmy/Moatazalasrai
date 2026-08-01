import { createHash } from "node:crypto";
import type { ProviderKind } from "@/lib/providers/types";

function enabled(value: string | undefined) { return value?.trim().toLowerCase() === "true"; }
function normalized(value: string) { return value.trim().replace(/\/+$/, ""); }

export function cloudflareAiGatewayStatus() {
  return { enabled: enabled(process.env.CLOUDFLARE_AI_GATEWAY_ENABLED), fallbackDirect: enabled(process.env.CLOUDFLARE_AI_GATEWAY_FALLBACK_DIRECT) };
}

export function resolveCloudflareGateway(input: {
  provider: ProviderKind;
  directBaseUrl: string;
  organizationId?: string;
  requestId?: string;
}) {
  if (!cloudflareAiGatewayStatus().enabled) return { baseUrl: normalized(input.directBaseUrl), headers: {} as Record<string, string>, gateway: false as const };
  if (input.provider === "openai_compatible") {
    throw new Error("Cloudflare AI Gateway routing is not enabled for arbitrary OpenAI-compatible endpoints.");
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const configuredBase = process.env.CLOUDFLARE_AI_GATEWAY_BASE_URL?.trim();
  if ((!configuredBase && (!accountId || !gatewayId)) || !apiToken) {
    throw new Error("Cloudflare AI Gateway requires CLOUDFLARE_API_TOKEN and either CLOUDFLARE_AI_GATEWAY_BASE_URL or account/gateway IDs.");
  }
  const root = normalized(configuredBase || `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}`);
  const parsed = new URL(root);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("CLOUDFLARE_AI_GATEWAY_BASE_URL must be a clean HTTPS URL.");
  }
  const providerPath = input.provider === "gemini" ? "google-ai-studio" : input.provider;
  const baseUrl = root.includes("{provider}") ? root.replace("{provider}", providerPath) : `${root}/${providerPath}`;
  const metadata = input.organizationId
    ? JSON.stringify({ organization: createHash("sha256").update(input.organizationId).digest("hex").slice(0, 24) })
    : undefined;
  return {
    baseUrl,
    gateway: true as const,
    headers: {
      "cf-aig-authorization": `Bearer ${apiToken}`,
      "cf-aig-skip-cache": "true",
      "cf-aig-collect-log-payload": "false",
      "cf-aig-max-attempts": "1",
      "cf-aig-request-timeout": "90000",
      ...(input.requestId ? { "cf-aig-event-id": input.requestId } : {}),
      ...(metadata ? { "cf-aig-metadata": metadata } : {}),
    },
  };
}
