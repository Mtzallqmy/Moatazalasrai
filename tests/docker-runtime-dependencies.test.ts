// Regression guard: Railway pre-deploy migrations must resolve Graphile Worker from the final image.
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
});
