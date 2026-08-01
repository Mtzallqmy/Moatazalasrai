import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import {
  decryptSecret,
  encryptSecret,
  hashApiKey,
  maskSecret,
  secureHashEquals,
} from "../src/lib/security/encryption";
import { ALL_API_SCOPES, normalizeApiScopes } from "@/lib/auth/api-key";

const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
const originalKeyId = process.env.CREDENTIAL_ENCRYPTION_KEY_ID;
const originalPreviousKeys = process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS;

beforeEach(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.CREDENTIAL_ENCRYPTION_KEY_ID = "current";
  delete process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
  if (originalKeyId === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY_ID;
  else process.env.CREDENTIAL_ENCRYPTION_KEY_ID = originalKeyId;
  if (originalPreviousKeys === undefined) delete process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS;
  else process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS = originalPreviousKeys;
});

describe("credential encryption", () => {
  it("round-trips a provider secret without storing plaintext", () => {
    const plaintext = "provider-secret-fixture-value";
    const envelope = encryptSecret(plaintext);
    expect(envelope).not.toContain(plaintext);
    expect(envelope.startsWith("v2.current.")).toBe(true);
    expect(decryptSecret(envelope)).toBe(plaintext);
  });

  it("uses a unique nonce for every encrypted value", () => {
    expect(encryptSecret("same-secret")).not.toBe(encryptSecret("same-secret"));
  });

  it("rejects tampered ciphertext", () => {
    const envelope = encryptSecret("secret");
    const tampered = `${envelope.slice(0, -1)}${envelope.endsWith("A") ? "B" : "A"}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("binds ciphertext to its declared context", () => {
    const envelope = encryptSecret("secret", "organization:one:provider");
    expect(decryptSecret(envelope, "organization:one:provider")).toBe("secret");
    expect(() => decryptSecret(envelope, "organization:two:provider")).toThrow();
  });

  it("reads previous key versions during a rotation", () => {
    const oldKey = Buffer.alloc(32, 3).toString("base64");
    process.env.CREDENTIAL_ENCRYPTION_KEY = oldKey;
    process.env.CREDENTIAL_ENCRYPTION_KEY_ID = "old";
    const envelope = encryptSecret("rotate-me");

    process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    process.env.CREDENTIAL_ENCRYPTION_KEY_ID = "current";
    process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({ old: oldKey });
    expect(decryptSecret(envelope)).toBe("rotate-me");
    expect(encryptSecret("new-secret").startsWith("v2.current.")).toBe(true);
  });

  it("keeps legacy v1 envelopes readable during migration", () => {
    const key = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY!, "base64");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update("legacy", "utf8"), cipher.final()]);
    const envelope = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
    expect(decryptSecret(envelope)).toBe("legacy");
  });
});

describe("API key security", () => {
  it("treats empty and unknown scope lists as no authority", () => {
    expect(normalizeApiScopes([])).toEqual([]);
    expect(normalizeApiScopes(["unknown", "agents:read", "agents:read"])).toEqual(["agents:read"]);
    expect(ALL_API_SCOPES).toContain("providers:write");
  });
  it("compares key hashes in constant-time compatible form", () => {
    const key = "map_live_example";
    const hash = hashApiKey(key);
    expect(secureHashEquals(hash, key)).toBe(true);
    expect(secureHashEquals(hash, `${key}-wrong`)).toBe(false);
  });

  it("never exposes a complete provider secret in its mask", () => {
    const secret = "sk-proj-1234567890abcd";
    const masked = maskSecret(secret);
    expect(masked).not.toContain(secret);
    expect(masked.endsWith("abcd")).toBe(true);
  });
});
