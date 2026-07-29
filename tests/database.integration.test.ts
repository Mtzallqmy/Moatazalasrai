import { describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("test database integration", () => {
  it("connects only to the explicitly configured isolated database", async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.CREDENTIAL_ENCRYPTION_KEY ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const { checkDatabase } = await import("@/db");
    const result = await checkDatabase();
    expect(result.ok).toBe(true);
    expect(result.schemaTables).toBeGreaterThanOrEqual(12);
  });
});
