import { createHmac, randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(value: Uint8Array) {
  let bits = 0;
  let buffer = 0;
  let output = "";
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

export function base32Decode(value: string) {
  const normalized = value.toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) throw new Error("TOTP_SECRET_INVALID");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totpCounter(atMs = Date.now()) {
  return Math.floor(atMs / 1000 / PERIOD_SECONDS);
}

export function totpCode(secret: string, counter: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function normalizeMfaCode(value: string) {
  return value.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function verifyTotpCode(input: {
  secret: string;
  code: string;
  atMs?: number;
  window?: number;
  lastUsedCounter?: number | null;
}) {
  const code = normalizeMfaCode(input.code);
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpCounter(input.atMs);
  const window = Math.min(Math.max(input.window ?? 1, 0), 2);
  for (let offset = -window; offset <= window; offset += 1) {
    const counter = current + offset;
    if (counter < 0 || (input.lastUsedCounter !== undefined && input.lastUsedCounter !== null && counter <= input.lastUsedCounter)) continue;
    if (totpCode(input.secret, counter) === code) return counter;
  }
  return null;
}

export function totpAuthUri(input: { secret: string; account: string; issuer: string }) {
  const label = `${input.issuer}:${input.account}`;
  const query = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}
