import { AsyncLocalStorage } from "node:async_hooks";

export type DatabaseAccessContext =
  | { kind: "tenant"; organizationId: string; userId: string | null }
  | { kind: "platform"; userId: string }
  | { kind: "system" };

const databaseAccessStorage = new AsyncLocalStorage<DatabaseAccessContext>();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string) {
  if (!uuidPattern.test(value)) throw new Error(`${label.toUpperCase()}_INVALID`);
  return value;
}

export function currentDatabaseAccessContext() {
  return databaseAccessStorage.getStore() ?? null;
}

export function enterTenantDatabaseContext(organizationId: string, userId?: string | null) {
  databaseAccessStorage.enterWith({
    kind: "tenant",
    organizationId: assertUuid(organizationId, "organization_id"),
    userId: userId ? assertUuid(userId, "user_id") : null,
  });
}

export function enterPlatformDatabaseContext(userId: string) {
  databaseAccessStorage.enterWith({ kind: "platform", userId: assertUuid(userId, "user_id") });
}

export function runWithSystemDatabaseContext<T>(action: () => T): T {
  return databaseAccessStorage.run({ kind: "system" }, action);
}

export function runWithTenantDatabaseContext<T>(
  input: { organizationId: string; userId?: string | null },
  action: () => T,
): T {
  return databaseAccessStorage.run({
    kind: "tenant",
    organizationId: assertUuid(input.organizationId, "organization_id"),
    userId: input.userId ? assertUuid(input.userId, "user_id") : null,
  }, action);
}
