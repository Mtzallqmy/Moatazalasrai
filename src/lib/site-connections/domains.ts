import ipaddr from "ipaddr.js";
import { ApiError } from "@/lib/http/api";
import { isPublicIp, validateProviderBaseUrl } from "@/lib/security/provider-network";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.aws.internal",
  "169.254.169.254",
  "100.100.100.200",
]);

export function normalizeSiteDomain(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new ApiError(400, "SITE_DOMAIN_INVALID", "اسم نطاق الموقع غير صالح.");
  }

  if (parsed.username || parsed.password || parsed.port || parsed.hash || parsed.search) {
    throw new ApiError(400, "SITE_DOMAIN_INVALID", "اسم النطاق يجب ألا يحتوي على بيانات اعتماد أو منفذ أو معاملات.");
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new ApiError(400, "SITE_DOMAIN_INVALID", "أدخل اسم النطاق دون مسار.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname
    || hostname.length > 253
    || hostname.includes("*")
    || BLOCKED_HOSTS.has(hostname)
    || hostname.endsWith(".local")
  ) {
    throw new ApiError(400, "SITE_DOMAIN_FORBIDDEN", "اسم النطاق غير مسموح.");
  }
  if (ipaddr.isValid(hostname) && !isPublicIp(hostname)) {
    throw new ApiError(400, "SITE_DOMAIN_PRIVATE", "لا يمكن ربط عنوان شبكة خاصة أو محجوزة.");
  }
  return hostname;
}

export async function validatePublicSiteDomain(value: string): Promise<string> {
  const domain = normalizeSiteDomain(value);
  await validateProviderBaseUrl(`https://${domain}`);
  return domain;
}

export function normalizeDomainAllowlist(siteDomain: string, values: readonly string[]): string[] {
  const normalized = [siteDomain, ...values].map(normalizeSiteDomain);
  return [...new Set(normalized)].sort();
}

export function isAllowedConnectionDomain(hostname: string, allowedDomains: readonly string[]): boolean {
  const normalized = normalizeSiteDomain(hostname);
  return allowedDomains.some((allowed) => normalizeSiteDomain(allowed) === normalized);
}
