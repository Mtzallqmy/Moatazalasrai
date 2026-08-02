import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function decodeKey(raw: string | undefined, name: string): Buffer {
  if (!raw) throw new Error(`${name} is not configured.`);
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) {
    throw new Error(`${name} must be a base64-encoded 32-byte key.`);
  }
  return decoded;
}

function currentKey() {
  const id = process.env.CREDENTIAL_ENCRYPTION_KEY_ID?.trim() || "primary";
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY_ID contains unsupported characters.");
  }
  return { id, key: decodeKey(process.env.CREDENTIAL_ENCRYPTION_KEY, "CREDENTIAL_ENCRYPTION_KEY") };
}

function keyForId(id: string): Buffer {
  const current = currentKey();
  if (id === current.id) return current.key;
  const raw = process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS?.trim();
  if (!raw) throw new Error("Encrypted secret key version is unavailable.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS must be a key/value object.");
  }
  const encoded = (parsed as Record<string, unknown>)[id];
  if (typeof encoded !== "string") throw new Error("Encrypted secret key version is unavailable.");
  return decodeKey(encoded, `CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS.${id}`);
}

function decodePart(value: string, expectedBytes?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Encrypted secret envelope is malformed.");
  const decoded = Buffer.from(value, "base64url");
  if (expectedBytes !== undefined && decoded.length !== expectedBytes) {
    throw new Error("Encrypted secret envelope is malformed.");
  }
  return decoded;
}

export function encryptSecret(plaintext: string, context = "secret"): string {
  if (!plaintext) throw new Error("Cannot encrypt an empty secret.");
  const { id, key } = currentKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(`v2.${id}.${context}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v2", id, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(envelope: string, context = "secret"): string {
  const parts = envelope.split(".");
  if (parts[0] === "v1" && parts.length === 4) {
    const [, ivPart, tagPart, ciphertextPart] = parts;
    const decipher = createDecipheriv(ALGORITHM, currentKey().key, decodePart(ivPart!, IV_BYTES));
    decipher.setAuthTag(decodePart(tagPart!, 16));
    return Buffer.concat([
      decipher.update(decodePart(ciphertextPart!)),
      decipher.final(),
    ]).toString("utf8");
  }
  if (parts[0] !== "v2" || parts.length !== 5) throw new Error("Unsupported encrypted secret envelope.");
  const [, keyId, ivPart, tagPart, ciphertextPart] = parts;
  if (!keyId || !/^[A-Za-z0-9_-]{1,40}$/.test(keyId)) throw new Error("Encrypted secret envelope is malformed.");
  const decipher = createDecipheriv(ALGORITHM, keyForId(keyId), decodePart(ivPart!, IV_BYTES));
  decipher.setAAD(Buffer.from(`v2.${keyId}.${context}`, "utf8"));
  decipher.setAuthTag(decodePart(tagPart!, 16));
  return Buffer.concat([
    decipher.update(decodePart(ciphertextPart!)),
    decipher.final(),
  ]).toString("utf8");
}

export function hashApiKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function secureHashEquals(expectedHex: string, value: string): boolean {
  const actual = Buffer.from(hashApiKey(value), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function maskSecret(value: string | undefined): string {
  if (!value) throw new Error("Cannot mask an empty secret.");
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}
