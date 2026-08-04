import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("security hardening contracts", () => {
  test("uses distributed Redis rate limiting without PostgreSQL", async () => {
    const source = await readFile("src/lib/security/rate-limit.ts", "utf8");
    expect(source).toContain("UPSTASH_REDIS_REST_URL");
    expect(source).toContain('"EVAL"');
    expect(source).toContain("RATE_LIMIT_BACKEND_UNAVAILABLE");
    expect(source).not.toContain('from "@/db"');
    expect(source).not.toContain("rateLimits");
  });

  test("verifies Telegram secret before parsing or processing the request body", async () => {
    const source = await readFile("src/app/api/webhooks/telegram/[integrationId]/route.ts", "utf8");
    const handler = source.slice(source.indexOf("export async function POST"));
    const secretCheck = handler.indexOf("secureHashEquals(expectedHash, suppliedSecret)");
    const bodyRead = handler.indexOf("request.json()");
    expect(secretCheck).toBeGreaterThanOrEqual(0);
    expect(bodyRead).toBeGreaterThan(secretCheck);
    expect(handler).toContain("TELEGRAM_SECRET_INVALID");
    expect(handler).toContain("telegram.webhook.ip");
  });

  test("keeps uploads quarantined until the worker scan completes", async () => {
    const [storage, queue, tasks, download] = await Promise.all([
      readFile("src/lib/storage/attachments.ts", "utf8"),
      readFile("src/worker/queue.ts", "utf8"),
      readFile("src/worker/task-list.ts", "utf8"),
      readFile("src/app/api/attachments/download/route.ts", "utf8"),
    ]);
    expect(storage).toContain('processingStatus: "quarantined"');
    expect(storage).toContain("enqueueAttachmentScan");
    expect(queue).toContain('addJob("attachment-scan"');
    expect(tasks).toContain('"attachment-scan": attachmentScanTask');
    expect(download).toContain('file.processingStatus !== "ready"');
    expect(download).toContain("verifyAttachmentDownloadToken");
  });

  test("makes bootstrap one-time and permanently disableable", async () => {
    const [bootstrap, disableScript, migration] = await Promise.all([
      readFile("src/lib/auth/bootstrap.ts", "utf8"),
      readFile("scripts/disable-bootstrap-admin-token.mjs", "utf8"),
      readFile("drizzle/0033_security_hardening.sql", "utf8"),
    ]);
    expect(bootstrap).toContain("BOOTSTRAP_ADMIN_TOKEN_EXPIRES_AT");
    expect(bootstrap).toContain("BOOTSTRAP_TOKEN_ALREADY_USED");
    expect(bootstrap).toContain("FOR UPDATE");
    expect(disableScript).toContain("permanently_disabled = true");
    expect(migration).toContain('CREATE TABLE "bootstrap_admin_tokens"');
  });

  test("protects audit logs and sends the complete security header set", async () => {
    const [migration, proxy] = await Promise.all([
      readFile("drizzle/0033_security_hardening.sql", "utf8"),
      readFile("src/proxy.ts", "utf8"),
    ]);
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
    expect(migration).toContain("BEFORE TRUNCATE");
    for (const header of [
      "content-security-policy",
      "strict-transport-security",
      "x-frame-options",
      "referrer-policy",
      "permissions-policy",
    ]) {
      expect(proxy).toContain(header);
    }
  });

  test("does not introduce RLS or duplicate IDOR tests in this phase", async () => {
    const migration = await readFile("drizzle/0033_security_hardening.sql", "utf8");
    expect(migration).not.toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(migration).not.toMatch(/CREATE\s+POLICY/i);
  });
});
