import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, resetEnvForTests } from "../src/lib/config/env";

const originalValues = new Map<string, string | undefined>();
const managedKeys = ["NODE_ENV", "DATABASE_URL", "CREDENTIAL_ENCRYPTION_KEY", "LOG_LEVEL", "APP_URL"] as const;

beforeEach(() => {
  for (const key of managedKeys) originalValues.set(key, process.env[key]);
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://user:pass@example.test/db?sslmode=require";
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  process.env.LOG_LEVEL = "info";
  delete process.env.APP_URL;
  resetEnvForTests();
});

afterEach(() => {
  for (const key of managedKeys) {
    const value = originalValues.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
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
    delete process.env.DATABASE_URL;
    expect(() => env()).toThrow("DATABASE_URL");
  });

  it("rejects an invalid encryption key", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = "not-a-32-byte-key";
    expect(() => env()).toThrow("32-byte");
  });

  it("requires HTTPS APP_URL in production", () => {
    process.env.NODE_ENV = "production";
    process.env.APP_URL = "http://example.com";
    expect(() => env()).toThrow("HTTPS");
  });
});
