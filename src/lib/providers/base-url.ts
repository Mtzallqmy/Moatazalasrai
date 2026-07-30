import type { ProviderKind } from "@/lib/providers/types";

export const AGENTROUTER_OPENAI_BASE_URL = "https://co.agentrouter.org/v1";

const AGENTROUTER_HOSTS = new Set([
  "agentrouter.org",
  "www.agentrouter.org",
  "co.agentrouter.org",
]);

/**
 * Correct only exact, documented aliases. Arbitrary provider URLs are never
 * rewritten and HTTP redirects remain disabled so bearer tokens cannot leak to
 * another origin.
 */
export function canonicalizeProviderBaseUrl(kind: ProviderKind, value: string) {
  const trimmed = value.trim();
  if (kind !== "openai_compatible" || !trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    const safeShape = parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && !parsed.port
      && !parsed.search
      && !parsed.hash;

    if (safeShape && AGENTROUTER_HOSTS.has(hostname) && (pathname === "/" || pathname === "/v1")) {
      return AGENTROUTER_OPENAI_BASE_URL;
    }
  } catch {
    // URL validation reports the actionable error later.
  }

  return trimmed;
}
