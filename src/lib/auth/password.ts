import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10 || password.length > 128) {
    throw new Error("يجب أن تتكون كلمة المرور من 10 إلى 128 حرفًا.");
  }

  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return ["scrypt", salt.toString("base64url"), derived.toString("base64url")].join(".");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltPart, hashPart] = encoded.split(".");
  if (algorithm !== "scrypt" || !saltPart || !hashPart) return false;

  const expected = Buffer.from(hashPart, "base64url");
  const actual = (await scrypt(password, Buffer.from(saltPart, "base64url"), expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
