// Regression guard: Railway startup and pre-deploy migrations must resolve every runtime asset.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production Docker runtime dependencies", () => {
  it("copies production dependencies and verifies Graphile Worker in the runner stage", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");

    expect(dockerfile).toContain("FROM base AS production-dependencies");
    expect(dockerfile).toContain("npm ci --omit=dev --no-audit --no-fund");
    expect(dockerfile).toContain("COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules");
    expect(dockerfile).toContain("await import('graphile-worker'); await import('pg')");
  });

  it("packages every production startup script used by Railway", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");
    const startup = await readFile("scripts/start-production.mjs", "utf8");

    expect(startup).toContain('"scripts/setup-telegram-webhook.mjs"');
    expect(dockerfile).toContain("/app/scripts/setup-telegram-webhook.mjs");
    expect(dockerfile).toContain("test -f /app/scripts/setup-telegram-webhook.mjs");
    expect(dockerfile).toContain("test -f /app/scripts/start-production.mjs");
    expect(dockerfile).toContain("test -f /app/scripts/validate-runtime-env.mjs");
  });
});
