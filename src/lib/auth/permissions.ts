import type { memberRole } from "@/db/schema";

export type Role = (typeof memberRole.enumValues)[number];
export type Permission =
  | "providers:read"
  | "providers:manage"
  | "agents:read"
  | "agents:manage"
  | "agents:run"
  | "runs:read"
  | "members:read"
  | "members:manage"
  | "audit:read"
  | "organization:manage"
  | "integrations:read"
  | "integrations:manage"
  | "files:read"
  | "files:upload"
  | "files:manage"
  | "site_connections:read"
  | "site_connections:manage"
  | "site_connections:use"
  | "site_connections:approve"
  | "browser_tasks:read"
  | "browser_tasks:run"
  | "browser_tasks:manage"
  | "browser_tasks:approve"
  | "sandbox:read"
  | "sandbox:use"
  | "sandbox:manage"
  | "sandbox:approve";

const permissions: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set([
    "providers:read", "providers:manage", "agents:read", "agents:manage", "agents:run",
    "runs:read", "members:read", "members:manage", "audit:read", "organization:manage",
    "integrations:read", "integrations:manage", "files:read", "files:upload", "files:manage",
    "site_connections:read", "site_connections:manage", "site_connections:use", "site_connections:approve",
    "browser_tasks:read", "browser_tasks:run", "browser_tasks:manage", "browser_tasks:approve",
    "sandbox:read", "sandbox:use", "sandbox:manage", "sandbox:approve",
  ]),
  admin: new Set([
    "providers:read", "providers:manage", "agents:read", "agents:manage", "agents:run",
    "runs:read", "members:read", "members:manage", "audit:read", "organization:manage",
    "integrations:read", "integrations:manage", "files:read", "files:upload", "files:manage",
    "site_connections:read", "site_connections:manage", "site_connections:use", "site_connections:approve",
    "browser_tasks:read", "browser_tasks:run", "browser_tasks:manage", "browser_tasks:approve",
    "sandbox:read", "sandbox:use", "sandbox:manage", "sandbox:approve",
  ]),
  developer: new Set([
    "providers:read", "providers:manage", "agents:read", "agents:manage", "agents:run", "runs:read",
    "integrations:read", "files:read", "files:upload", "files:manage",
    "site_connections:read", "site_connections:manage", "site_connections:use",
    "browser_tasks:read", "browser_tasks:run",
    "sandbox:read", "sandbox:use", "sandbox:manage",
  ]),
  operator: new Set([
    "providers:read", "agents:read", "agents:run", "runs:read", "integrations:read",
    "files:read", "files:upload", "files:manage",
    "site_connections:read", "site_connections:use", "site_connections:approve",
    "browser_tasks:read", "browser_tasks:run", "browser_tasks:approve",
    "sandbox:read", "sandbox:use", "sandbox:approve",
  ]),
  viewer: new Set([
    "providers:read", "agents:read", "runs:read", "integrations:read", "files:read",
    "site_connections:read", "browser_tasks:read", "sandbox:read",
  ]),
  member: new Set([
    "agents:read", "agents:run", "files:read", "files:upload",
    "site_connections:read", "site_connections:use",
    "browser_tasks:read", "browser_tasks:run",
    "sandbox:read", "sandbox:use",
  ]),
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return role ? permissions[role].has(permission) : false;
}

export function permissionsFor(role: Role | null | undefined): Permission[] {
  return role ? [...permissions[role]] : [];
}
