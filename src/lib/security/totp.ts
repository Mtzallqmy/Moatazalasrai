import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

export function encodeBase32(input: Buffer) {
  let bits = "";
  for (const byte of input) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, "0");
    output += BASE32_ALPHABET[Number.parseInt(chunk, 2)];
  }
  return output;
}

export function decodeBase32(value: string) {
  const normalized = value.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) throw new Error("MFA_SECRET_INVALID");
  let bits = "";
  for (const character of normalized) bits += BASE32_ALPHABET.indexOf(character).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

export function generateTotpSecret() {
  return encodeBase32(randomBytes(20));
}

function counterBuffer(step: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(step));
  return buffer;
}

export function totpCode(secret: string, step = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS)) {
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBuffer(step)).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function safeCodeEquals(expected: string, actual: string) {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyTotp(input: {
  secret: string;
  code: string;
  now?: number;
  window?: number;
  lastUsedStep?: number | null;
}) {
  const code = input.code.replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const currentStep = Math.floor((input.now ?? Date.now()) / 1000 / TOTP_PERIOD_SECONDS);
  const window = Math.max(0, Math.min(input.window ?? 1, 2));
  for (let offset = -window; offset <= window; offset += 1) {
    const step = currentStep + offset;
    if (step <= (input.lastUsedStep ?? -1)) continue;
    if (safeCodeEquals(totpCode(input.secret, step), code)) return step;
  }
  return null;
}

export function totpUri(input: { secret: string; account: string; issuer: string }) {
  const label = `${input.issuer}:${input.account}`;
  const query = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: Math.max(5, Math.min(count, 20)) }, () => {
    const value = randomBytes(8).toString("hex").toUpperCase();
    return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}`;
  });
}

export function hashRecoveryCode(code: string) {
  return createHash("sha256").update(code.replace(/[^A-Za-z0-9]/g, "").toUpperCase(), "utf8").digest("hex");
}
