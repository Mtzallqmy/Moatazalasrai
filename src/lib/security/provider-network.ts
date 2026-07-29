import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { ApiError } from "@/lib/http/api";

const ALLOWED_PRODUCTION_PORTS = new Set(["", "443", "8443"]);
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.aws.internal",
]);

export type SafeUrlResult = {
  normalizedUrl: string;
  addresses: string[];
};

export function isPublicIp(value: string): boolean {
  let address: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    address = ipaddr.parse(value);
  } catch {
    return false;
  }
  const range = address.range();
  return range === "unicast";
}

export async function validateProviderBaseUrl(value: string): Promise<SafeUrlResult> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ApiError(400, "INVALID_BASE_URL", "صيغة Base URL غير صحيحة.");
  }
  if (parsed.username || parsed.password) {
    throw new ApiError(400, "URL_CREDENTIALS_FORBIDDEN", "لا يُسمح بوضع بيانات اعتماد داخل Base URL.");
  }
  if (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && parsed.protocol === "http:")) {
    throw new ApiError(400, "HTTPS_REQUIRED", "يجب أن يستخدم Base URL بروتوكول HTTPS.");
  }
  if (process.env.NODE_ENV === "production" && !ALLOWED_PRODUCTION_PORTS.has(parsed.port)) {
    throw new ApiError(400, "PORT_NOT_ALLOWED", "المنفذ المحدد غير مسموح في بيئة الإنتاج.");
  }
  parsed.hash = "";
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new ApiError(400, "PRIVATE_HOST_FORBIDDEN", "عنوان المزود يشير إلى شبكة داخلية غير مسموحة.");
  }

  let addresses: string[];
  if (ipaddr.isValid(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
    } catch {
      throw new ApiError(422, "DNS_FAILED", "تعذر حل اسم نطاق المزود.");
    }
  }
  if (addresses.length === 0 || addresses.some((address) => !isPublicIp(address))) {
    throw new ApiError(400, "PRIVATE_ADDRESS_FORBIDDEN", "عنوان المزود تحوّل إلى شبكة خاصة أو محجوزة.");
  }
  return {
    normalizedUrl: parsed.toString().replace(/\/$/, ""),
    addresses: [...new Set(addresses)],
  };
}
