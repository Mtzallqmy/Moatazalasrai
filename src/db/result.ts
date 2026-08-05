// Normalizes Drizzle raw-query results across drivers without leaking driver-specific shapes.
export function databaseRows<T>(result: T[] | { rows: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows;
}
