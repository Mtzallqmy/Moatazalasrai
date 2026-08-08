import { AsyncLocalStorage } from "node:async_hooks";

export type DatabaseQueryMetrics = { count: number };

const queryMetricsStorage = new AsyncLocalStorage<DatabaseQueryMetrics>();

export function runWithDatabaseQueryMetrics<T>(action: (metrics: DatabaseQueryMetrics) => T): T {
  const metrics = { count: 0 };
  return queryMetricsStorage.run(metrics, () => action(metrics));
}

export const databaseQueryLogger = {
  logQuery() {
    const metrics = queryMetricsStorage.getStore();
    if (metrics) metrics.count += 1;
  },
};
