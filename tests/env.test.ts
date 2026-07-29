import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, resetEnvForTests } from "../src/lib/config/env";

const originalValues = new Map<string, string | undefined>();
const managedKeys = ["NODE_ENV", "DATABASE_URL", "CREDENTIAL_ENCRYPTION_KEY", "LOG_LEVEL", "APP_URL"] as const;

type ManagedKey = (typeof managedKeys)[number];

function setEnv(key: ManagedKey, value: string) {
  Object.defineProperty(process.env, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function deleteEnv(key: ManagedKey) {
  Reflect.deleteProperty(process.env, key);
}

beforeEach(() => {
  for (const key of managedKeys) originalValues.set(key, process.env[key]);
  setEnv("NODE_ENV", "test");
  setEnv("DATABASE_URL", "postgresql://user:pass@example.test/db?sslmode=require");
  setEnv("CREDENTIAL_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
  setEnv("LOG_LEVEL", "info");
  deleteEnv("APP_URL");
  resetEnvForTests();
});

afterEach(() => {
  for (const key of managedKeys) {
    const value = originalValues.get(key);
    if (value === undefined) deleteEnv(key);
    else setEnv(key, value);
  }
  originalValues.clear();
  resetEnvForTests();
});

describe("runtime environment validation", () => {
  it("loads a valid environment", () => {
    const config = env();
    expect(config.nodeEnv).toBe("test");
    expect(config.databaseUrl).toContain("postgresql://");
  });

  it("fails fast when DATABASE_URL is missing", () => {
    deleteEnv("DATABASE_URL");
    expect(() => env()).toThrow("DATABASE_URL");
  });

  it("rejects an invalid encryption key", () => {
    setEnv("CREDENTIAL_ENCRYPTION_KEY", "not-a-32-byte-key");
    expect(() => env()).toThrow("32-byte");
  });

  it("requires HTTPS APP_URL in production", () => {
    setEnv("NODE_ENV", "production");
    setEnv("APP_URL", "http://example.com");
    expect(() => env()).toThrow("HTTPS");
  });

  it("requires APP_URL in production", () => {
    setEnv("NODE_ENV", "production");
    deleteEnv("APP_URL");
    expect(() => env()).toThrow("APP_URL");
  });
});
