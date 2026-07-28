import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

function deriveKey(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10 || password.length > 128) {
    throw new Error("يجب أن تتكون كلمة المرور من 10 إلى 128 حرفًا.");
  }

  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, KEY_LENGTH);
  return ["scrypt", salt.toString("base64url"), derived.toString("base64url")].join(".");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltPart, hashPart] = encoded.split(".");
  if (algorithm !== "scrypt" || !saltPart || !hashPart) return false;

  const expected = Buffer.from(hashPart, "base64url");
  const actual = await deriveKey(password, Buffer.from(saltPart, "base64url"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
