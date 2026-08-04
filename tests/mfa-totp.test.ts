import { describe, expect, test } from "vitest";
import { permissionRequiresMfa } from "@/lib/auth/mfa";
import { base32Decode, base32Encode, totpCode, verifyTotpCode } from "@/lib/security/totp";

describe("TOTP MFA hardening", () => {
  test("implements the RFC 6238 SHA-1 vector reduced to six digits", () => {
    const secretBytes = Buffer.from("12345678901234567890", "ascii");
    const secret = base32Encode(secretBytes);
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(secret)).toEqual(secretBytes);
    expect(totpCode(secret, 1)).toBe("287082");
    expect(verifyTotpCode({ secret, code: "287082", atMs: 59_000, window: 0 })).toBe(1);
  });

  test("rejects replay of an already consumed TOTP counter", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(verifyTotpCode({
      secret,
      code: "287082",
      atMs: 59_000,
      window: 0,
      lastUsedCounter: 1,
    })).toBeNull();
  });

  test("requires MFA only for privileged sensitive permissions", () => {
    expect(permissionRequiresMfa("owner", "providers:manage")).toBe(true);
    expect(permissionRequiresMfa("admin", "agents:run")).toBe(true);
    expect(permissionRequiresMfa("admin", "providers:read")).toBe(false);
    expect(permissionRequiresMfa("developer", "providers:manage")).toBe(false);
  });
});
