// Carries tenant or explicit system database scope through one asynchronous request or worker task.
import { AsyncLocalStorage } from "node:async_hooks";

type DatabaseContext =
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
  storage.enterWith({
    mode: organizationId ? "tenant" : "user",
    userId,
    ...(organizationId ? { organizationId } : {}),
  });
}

export function enterTenantDatabaseContext(organizationId: string, userId?: string | null) {
  storage.enterWith({
    mode: "tenant",
    organizationId,
    ...(userId ? { userId } : {}),
  });
}

export function runWithTenantDatabaseContext<T>(
  organizationId: string,
  userId: string | null | undefined,
  action: () => T,
) {
  return storage.run({
    mode: "tenant",
    organizationId,
    ...(userId ? { userId } : {}),
  }, action);
}

export function runWithUserDatabaseContext<T>(userId: string, action: () => T) {
  return storage.run({ mode: "user", userId }, action);
}

export function runWithSystemDatabaseContext<T>(reason: string, action: () => T) {
  if (!reason.trim()) throw new Error("A system database context requires an audit reason.");
  return storage.run({ mode: "system", reason }, action);
}
