import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function deriveKey(
  password: string,
  salt: Buffer,
  length: number,
  options: { N: number; r: number; p: number } = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, { ...options, maxmem: 64 * 1024 * 1024 }, (error, derivedKey) => {
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
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (password.length > 128) return false;
  if (encoded.startsWith("scrypt$")) {
    const [algorithm, nPart, rPart, pPart, saltPart, hashPart] = encoded.split("$");
    const N = Number(nPart);
    const r = Number(rPart);
    const p = Number(pPart);
    if (
      algorithm !== "scrypt" ||
      !saltPart ||
      !hashPart ||
      !Number.isInteger(N) ||
      !Number.isInteger(r) ||
      !Number.isInteger(p) ||
      N < 16384 ||
      N > 131072 ||
      r < 1 ||
      r > 16 ||
      p < 1 ||
      p > 4
    ) return false;
    const expected = Buffer.from(hashPart, "base64url");
    const actual = await deriveKey(password, Buffer.from(saltPart, "base64url"), expected.length, { N, r, p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  // Backward-compatible verification for hashes created before the parameterized format.
  const [algorithm, saltPart, hashPart] = encoded.split(".");
  if (algorithm !== "scrypt" || !saltPart || !hashPart) return false;

  const expected = Buffer.from(hashPart, "base64url");
  const actual = await deriveKey(password, Buffer.from(saltPart, "base64url"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
