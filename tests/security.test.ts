import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hashApiKey,
  maskSecret,
  secureHashEquals,
} from "../src/lib/security/encryption";

const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
});

describe("credential encryption", () => {
  it("round-trips a provider secret without storing plaintext", () => {
    const plaintext = "sk-production-secret-value";
    const envelope = encryptSecret(plaintext);
    expect(envelope).not.toContain(plaintext);
    expect(envelope.startsWith("v1.")).toBe(true);
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
});

describe("API key security", () => {
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
