import ipaddr from "ipaddr.js";

export type ClientIpSource = "cloudflare" | "forwarded" | "runtime" | "none";

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function normalized(value: string | null | undefined) {
  const candidate = value?.trim();
  if (!candidate || !ipaddr.isValid(candidate)) return null;
  const parsed = ipaddr.parse(candidate);
  if (parsed.kind() === "ipv6") {
    const ipv6 = parsed as ipaddr.IPv6;
    if (ipv6.isIPv4MappedAddress()) return ipv6.toIPv4Address().toString();
  }
  return parsed.toNormalizedString();
}

export function clientIp(request: Request, runtimeAddress?: string | null): { address: string | null; source: ClientIpSource } {
  if (enabled(process.env.TRUST_CLOUDFLARE_PROXY)) {
    const cloudflare = normalized(request.headers.get("cf-connecting-ip"));
    if (cloudflare) return { address: cloudflare, source: "cloudflare" };
  }
  // Railway (or another ingress) must overwrite this header and direct origin access
  // must be blocked before TRUST_PROXY_HEADERS is enabled.
  if (enabled(process.env.TRUST_PROXY_HEADERS)) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")
      .map((item) => normalized(item)).find((item): item is string => Boolean(item));
    if (forwarded) return { address: forwarded, source: "forwarded" };
  }
  const runtime = normalized(runtimeAddress);
  return runtime ? { address: runtime, source: "runtime" } : { address: null, source: "none" };
}

export function anonymizeIp(address: string | null) {
  if (!address) return undefined;
  const parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv4") {
    const bytes = parsed.toByteArray();
    return `${bytes[0]}.${bytes[1]}.${bytes[2]}.0/24`;
  }
  const parts = parsed.toNormalizedString().split(":");
  return `${parts.slice(0, 4).join(":")}::/64`;
}
