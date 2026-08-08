import { describe, expect, it } from "vitest";
import { databaseQueryLogger, runWithDatabaseQueryMetrics } from "@/db/query-observability";

describe("request-scoped database query observability", () => {
  it("counts concurrent request queries independently without recording SQL", async () => {
    const [first, second] = await Promise.all([
      runWithDatabaseQueryMetrics(async (metrics) => {
        databaseQueryLogger.logQuery();
        await Promise.resolve();
        databaseQueryLogger.logQuery();
        return metrics.count;
      }),
      runWithDatabaseQueryMetrics(async (metrics) => {
        await Promise.resolve();
        databaseQueryLogger.logQuery();
        return metrics.count;
      }),
    ]);
    expect(first).toBe(2);
    expect(second).toBe(1);
  });
});
