import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "@/lib/storage/attachments";

describe("integration and native API foundation", () => {
  it("uses an additive migration with tenant isolation and Telegram idempotency", async () => {
    const migration = await readFile("drizzle/0005_integrations_files_api.sql", "utf8");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "integrations"');
    expect(migration).toContain('"organization_id" uuid NOT NULL');
    expect(migration).toContain('"telegram_updates_integration_update_unique_idx"');
    expect(migration).toContain('"attachments_size_check"');
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE/i);
  });

  it("enforces bounded attachment storage", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024);
    expect(ALLOWED_ATTACHMENT_TYPES).toContain("application/pdf");
    expect(ALLOWED_ATTACHMENT_TYPES).toContain("image/webp");
    expect(ALLOWED_ATTACHMENT_TYPES.has("application/x-msdownload")).toBe(false);
  });

  it("publishes native API discovery and authenticated resource routes", async () => {
    const openApi = await readFile("src/app/api/v1/openapi/route.ts", "utf8");
    expect(openApi).toContain('"/api/v1/chat"');
    expect(openApi).toContain('"/api/v1/files"');
    expect(openApi).toContain('"/api/v1/github"');
    expect(openApi).toContain("bearerAuth");
  });

  it("keeps external integration hosts fixed", async () => {
    const telegram = await readFile("src/lib/integrations/telegram.ts", "utf8");
    const github = await readFile("src/lib/integrations/github.ts", "utf8");
    expect(telegram).toContain("https://api.telegram.org/");
    expect(github).toContain('const GITHUB_API = "https://api.github.com"');
    expect(github).toContain('path.includes("..")');
  });
});
