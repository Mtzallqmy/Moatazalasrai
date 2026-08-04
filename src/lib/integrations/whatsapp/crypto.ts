import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function hashWhatsAppConnectToken(token: string, secret: string) {
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}

export function secureStringEquals(expected: string, supplied: string) {
  const left = createHash("sha256").update(expected, "utf8").digest();
  const right = createHash("sha256").update(supplied, "utf8").digest();
  return timingSafeEqual(left, right);
}

export function verifyMetaWebhookSignature(rawBody: string, signatureHeader: string | null, appSecret: string) {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const suppliedHex = signatureHeader.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(suppliedHex)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const supplied = Buffer.from(suppliedHex, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function normalizeWhatsAppId(value: string) {
  const normalized = value.replace(/\D/g, "");
  if (!/^\d{6,20}$/.test(normalized)) throw new Error("WHATSAPP_WA_ID_INVALID");
  return normalized;
}

export function maskWhatsAppId(value: string) {
  const normalized = normalizeWhatsAppId(value);
  return `••••••${normalized.slice(-4)}`;
}

export function maskEmail(value: string) {
  const [local = "", domain = ""] = value.split("@", 2);
  if (!domain) return "غير متاح";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}
