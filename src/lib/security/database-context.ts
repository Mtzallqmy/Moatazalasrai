// Carries tenant or explicit system database scope through one asynchronous request or worker task.
import { AsyncLocalStorage } from "node:async_hooks";

export type DatabaseContext =
  | { mode: "tenant"; organizationId: string; userId?: string }
  | { mode: "user"; userId: string; organizationId?: string }
  | { mode: "system"; reason: string };

const globalForContext = globalThis as typeof globalThis & {
  __moatazDatabaseContext?: AsyncLocalStorage<DatabaseContext>;
};

const storage = globalForContext.__moatazDatabaseContext
  ??= new AsyncLocalStorage<DatabaseContext>();

export function currentDatabaseContext() {
  return storage.getStore() ?? null;
}

export function enterUserDatabaseContext(userId: string, organizationId?: string | null) {
  if (organizationId) {
    storage.enterWith({ mode: "tenant", userId, organizationId });
    return;
  }
  storage.enterWith({ mode: "user", userId });
}

export function enterTenantDatabaseContext(organizationId: string, userId?: string | null) {
  storage.enterWith(userId
    ? { mode: "tenant", organizationId, userId }
    : { mode: "tenant", organizationId });
}

export function runWithTenantDatabaseContext<T>(
  organizationId: string,
  userId: string | null | undefined,
  action: () => T,
) {
  return storage.run(userId
    ? { mode: "tenant", organizationId, userId }
    : { mode: "tenant", organizationId }, action);
}

export function runWithUserDatabaseContext<T>(userId: string, action: () => T) {
  return storage.run({ mode: "user", userId }, action);
}

export function runWithSystemDatabaseContext<T>(reason: string, action: () => T) {
  if (!reason.trim()) throw new Error("A system database context requires an audit reason.");
  return storage.run({ mode: "system", reason }, action);
}
