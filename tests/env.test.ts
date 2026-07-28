import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, resetEnvForTests } from "../src/lib/config/env";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://user:pass@example.test/db?sslmode=require";
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  process.env.LOG_LEVEL = "info";
  delete process.env.APP_URL;
  resetEnvForTests();
});

afterEach(() => {
  process.env = { ...originalEnv };
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
