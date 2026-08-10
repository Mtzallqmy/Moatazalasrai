import { AsyncLocalStorage } from "node:async_hooks";

export type DatabaseQueryMetrics = {
  count: number;
  bySubsystem: Record<string, number>;
};

const queryMetricsStorage = new AsyncLocalStorage<DatabaseQueryMetrics>();
const querySubsystemStorage = new AsyncLocalStorage<string>();

export function runWithDatabaseQueryMetrics<T>(action: (metrics: DatabaseQueryMetrics) => T): T {
  const metrics: DatabaseQueryMetrics = { count: 0, bySubsystem: {} };
  return queryMetricsStorage.run(metrics, () => action(metrics));
}

export function withDatabaseQuerySubsystem<T>(subsystem: string, action: () => T): T {
  return querySubsystemStorage.run(subsystem, action);
}

export const databaseQueryLogger = {
  logQuery() {
    const metrics = queryMetricsStorage.getStore();
    if (!metrics) return;
    metrics.count += 1;
    const subsystem = querySubsystemStorage.getStore() ?? "unclassified";
    metrics.bySubsystem[subsystem] = (metrics.bySubsystem[subsystem] ?? 0) + 1;
  },
};
