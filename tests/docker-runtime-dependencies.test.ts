// Regression guard: Railway startup and pre-deploy migrations must resolve every runtime asset.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production Docker runtime dependencies", () => {
  it("bundles the Graphile Worker source and keeps only production dependencies in the runner", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");
    const packageJson = await readFile("package.json", "utf8");
    const workerStartup = await readFile("scripts/start-worker.mjs", "utf8");

    expect(dockerfile).toContain("FROM base AS production-dependencies");
    expect(dockerfile).toContain("npm ci --omit=dev --no-audit --no-fund");
    expect(dockerfile).toContain("./node_modules/.bin/esbuild src/worker/index.ts");
    expect(dockerfile).toContain("--outfile=dist/worker.mjs");
    expect(dockerfile).toContain("COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist");
    expect(dockerfile).toContain("test -f /app/dist/worker.mjs");
    expect(dockerfile).toContain("COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules");
    expect(dockerfile).toContain("await import('graphile-worker'); await import('pg')");
    expect(packageJson).toContain('"worker": "node scripts/start-worker.mjs"');
    expect(workerStartup).toContain("dist/worker.mjs");
    expect(workerStartup).toContain('mode: existsSync(bundledWorker) ? "bundle" : "source"');
  });

  it("packages every production startup script and channel migration used by Railway", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");
    const startup = await readFile("scripts/start-production.mjs", "utf8");

    expect(startup).toContain("setup-telegram-webhook.mjs");
    expect(startup).toContain("check-telegram-schema.mjs");
    expect(startup).toContain('enabled("WHATSAPP_INTEGRATION_ENABLED")');
    expect(dockerfile).toContain("/app/scripts/start-worker.mjs");
    expect(dockerfile).toContain("/app/scripts/setup-telegram-webhook.mjs");
    expect(dockerfile).toContain("/app/scripts/check-telegram-schema.mjs");
    expect(dockerfile).toContain("test -f /app/scripts/start-worker.mjs");
    expect(dockerfile).toContain("test -f /app/scripts/setup-telegram-webhook.mjs");
    expect(dockerfile).toContain("test -f /app/scripts/check-telegram-schema.mjs");
    expect(dockerfile).toContain("test -f /app/drizzle/0039_central_telegram_bot.sql");
    expect(dockerfile).toContain("test -f /app/drizzle/0040_telegram_admin_default_permissions.sql");
    expect(dockerfile).toContain("test -f /app/drizzle/0041_channel_client_sessions.sql");
    expect(dockerfile).toContain("test -f /app/scripts/start-production.mjs");
    expect(dockerfile).toContain("test -f /app/scripts/validate-runtime-env.mjs");
  });
});
