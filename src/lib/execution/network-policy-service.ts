import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { networkPolicySchema, type NetworkPolicy } from "@/lib/execution/contracts";
import { ExecutionError } from "@/lib/execution/errors";

const metadataHosts = new Set([
  "metadata.google.internal",
  "metadata.google.internal.",
  "instance-data.ec2.internal",
  "metadata.azure.internal",
]);

export function defaultNetworkPolicy(): NetworkPolicy {
  return networkPolicySchema.parse({
    mode: process.env.EXECUTION_DEFAULT_NETWORK_MODE === "allowlist" ? "allowlist" : "deny_all",
    allowedHosts: [],
    allowedPorts: [],
    allowDns: false,
    allowedMethods: ["GET", "HEAD"],
    maxRequests: 0,
  });
}

export function normalizeNetworkPolicy(input?: Partial<NetworkPolicy>): NetworkPolicy {
  const base = defaultNetworkPolicy();
  const parsed = networkPolicySchema.parse({ ...base, ...(input ?? {}) });
  if (parsed.mode === "deny_all") {
    return { ...parsed, allowedHosts: [], allowedPorts: [], allowDns: false, maxRequests: 0 };
  }
  if (!parsed.allowedHosts.length || !parsed.allowedPorts.length || parsed.maxRequests < 1) {
    throw new ExecutionError("EXECUTION_NETWORK_DENIED", "سياسة الشبكة المسموحة تتطلب hosts ومنافذ وحد طلبات صريحًا.");
  }
  return {
    ...parsed,
    allowedHosts: Array.from(new Set(parsed.allowedHosts.map(normalizeHostname))),
    allowedPorts: Array.from(new Set(parsed.allowedPorts)),
  };
}

export function normalizeHostname(value: string) {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || metadataHosts.has(host) || host.endsWith(".localhost")) {
    throw new ExecutionError("EXECUTION_NETWORK_DENIED", "عنوان الشبكة غير مسموح.");
  }
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(host) || host.includes("..")) {
    throw new ExecutionError("EXECUTION_NETWORK_DENIED", "اسم المضيف غير صالح.");
  }
  return host;
}

export function isPublicAddress(value: string) {
  let address: ipaddr.IPv4 | ipaddr.IPv6;
  try { address = ipaddr.parse(value); } catch { return false; }
  let normalized: ipaddr.IPv4 | ipaddr.IPv6 = address;
  if (address.kind() === "ipv6") {
    const ipv6 = address as ipaddr.IPv6;
    normalized = ipv6.isIPv4MappedAddress() ? ipv6.toIPv4Address() : ipv6;
  }
  const range = normalized.range();
  return !new Set([
    "unspecified",
    "broadcast",
    "multicast",
    "linkLocal",
    "loopback",
    "private",
    "reserved",
    "uniqueLocal",
    "carrierGradeNat",
  ]).has(range);
}

export async function resolvePublicHost(hostname: string) {
  const host = normalizeHostname(hostname);
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) throw new ExecutionError("EXECUTION_NETWORK_DENIED", "عناوين IP الخاصة أو المحلية ممنوعة.");
    return [host];
  }
  let rows: Array<{ address: string }>;
  try {
    rows = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ExecutionError("EXECUTION_NETWORK_DENIED", "تعذر حل اسم المضيف المسموح.");
  }
  const addresses = Array.from(new Set(rows.map((row) => row.address)));
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) {
    throw new ExecutionError("EXECUTION_NETWORK_DENIED", "يشير المضيف إلى شبكة داخلية أو محجوزة.");
  }
  return addresses;
}

export async function assertAllowedEgressUrl(input: {
  policy: NetworkPolicy;
  url: string;
  method: string;
}) {
  if (input.policy.mode !== "allowlist") {
    throw new ExecutionError("EXECUTION_NETWORK_DENIED", "الشبكة معطلة لهذه العملية.");
  }
  let url: URL;
  try { url = new URL(input.url); } catch {
    throw new ExecutionError("EXECUTION_NETWORK_DENIED", "رابط الشبكة غير صالح.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ExecutionError("EXECUTION_NETWORK_DENIED", "يسمح ببروتوكولي HTTP وHTTPS فقط.");
  }
  if (url.username || url.password || url.hash) {
    throw new ExecutionError("EXECUTION_NETWORK_DENIED", "لا يسمح ببيانات اعتماد أو fragment داخل الرابط.");
  }
  const host = normalizeHostname(url.hostname);
  if (!input.policy.allowedHosts.includes(host)) {
    throw new ExecutionError("EXECUTION_NETWORK_DENIED", "المضيف غير موجود في قائمة السماح.");
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!input.policy.allowedPorts.includes(port)) {
    throw new ExecutionError("EXECUTION_NETWORK_DENIED", "منفذ الشبكة غير مسموح.");
  }
  const method = input.method.toUpperCase();
  if (!input.policy.allowedMethods.includes(method as NetworkPolicy["allowedMethods"][number])) {
    throw new ExecutionError("EXECUTION_NETWORK_DENIED", "طريقة HTTP غير مسموحة.");
  }
  const addresses = await resolvePublicHost(host);
  return { url, host, port, addresses };
}

export function assertRedirectAllowed(originalHost: string, location: string, policy: NetworkPolicy) {
  const target = new URL(location);
  const host = normalizeHostname(target.hostname);
  if (host !== normalizeHostname(originalHost) || !policy.allowedHosts.includes(host)) {
    throw new ExecutionError("EXECUTION_NETWORK_DENIED", "رفض تحويل الشبكة إلى مضيف غير مصرح.");
  }
  return target;
}
