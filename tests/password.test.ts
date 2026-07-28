import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";

describe("password security", () => {
  it("hashes and verifies a valid password", async () => {
    const password = "A-strong-password-123";
    const hash = await hashPassword(password);
    expect(hash).not.toContain(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("uses a unique salt", async () => {
    const password = "A-strong-password-123";
    await expect(hashPassword(password)).resolves.not.toBe(await hashPassword(password));
  });

  it("rejects short passwords", async () => {
    await expect(hashPassword("short")).rejects.toThrow("10");
  });
});
