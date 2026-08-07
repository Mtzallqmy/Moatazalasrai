import type { memberRole } from "@/db/schema";

export type Role = (typeof memberRole.enumValues)[number];

export const ALL_PERMISSIONS = [
  "providers:read", "providers:manage",
  "agents:read", "agents:manage", "agents:run",
  "runs:read",
  "members:read", "members:manage",
  "audit:read", "analytics:read",
  "organization:manage",
  "integrations:read", "integrations:manage",
  "channels:read", "channels:manage", "channels:use", "channels:handoff",
  "notifications:read", "notifications:manage", "notifications:send",
  "platform:read", "platform:manage", "trash:manage",
  "content:read", "content:manage", "content:publish",
  "services:read", "services:manage",
  "menus:read", "menus:manage",
  "security:read", "security:manage",
  "files:read", "files:upload", "files:manage",
  "site_connections:read", "site_connections:manage", "site_connections:use", "site_connections:approve",
  "browser_tasks:read", "browser_tasks:run", "browser_tasks:manage", "browser_tasks:approve",
  "sandbox:read", "sandbox:use", "sandbox:manage", "sandbox:approve",
  "executions:read", "executions:run", "executions:manage",
] as const;

export type Permission = typeof ALL_PERMISSIONS[number];

const ownerPermissions = new Set<Permission>(ALL_PERMISSIONS);
const permissions: Record<Role, ReadonlySet<Permission>> = {
  owner: ownerPermissions,
  admin: new Set(ALL_PERMISSIONS),
  developer: new Set([
    "providers:read", "providers:manage", "agents:read", "agents:manage", "agents:run", "runs:read",
    "integrations:read", "channels:read", "channels:manage", "channels:use", "channels:handoff",
    "notifications:read", "notifications:send", "platform:read", "analytics:read",
    "content:read", "services:read", "menus:read", "security:read",
    "files:read", "files:upload", "files:manage",
    "site_connections:read", "site_connections:manage", "site_connections:use",
    "browser_tasks:read", "browser_tasks:run",
    "sandbox:read", "sandbox:use", "sandbox:manage",
    "executions:read", "executions:run", "executions:manage",
  ]),
  operator: new Set([
    "providers:read", "agents:read", "agents:run", "runs:read", "integrations:read",
    "channels:read", "channels:use", "channels:handoff", "notifications:read", "notifications:send",
    "platform:read", "analytics:read", "content:read", "services:read", "menus:read", "security:read",
    "files:read", "files:upload", "files:manage",
    "site_connections:read", "site_connections:use", "site_connections:approve",
    "browser_tasks:read", "browser_tasks:run", "browser_tasks:approve",
    "sandbox:read", "sandbox:use", "sandbox:approve",
    "executions:read", "executions:run",
  ]),
  viewer: new Set([
    "providers:read", "agents:read", "runs:read", "integrations:read", "channels:read",
    "notifications:read", "platform:read", "analytics:read", "content:read", "services:read", "menus:read",
    "files:read", "site_connections:read", "browser_tasks:read", "sandbox:read", "executions:read",
  ]),
  member: new Set([
    "agents:read", "agents:run", "channels:read", "channels:use", "notifications:read",
    "content:read", "services:read", "menus:read", "files:read", "files:upload",
    "site_connections:read", "site_connections:use", "browser_tasks:read", "browser_tasks:run",
    "sandbox:read", "sandbox:use", "security:read",
  ]),
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return role ? permissions[role].has(permission) : false;
}

export function permissionsFor(role: Role | null | undefined): Permission[] {
  return role ? [...permissions[role]] : [];
}
