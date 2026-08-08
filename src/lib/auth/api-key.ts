import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { enterTenantDatabaseContext, runWithSystemDatabaseContext } from "@/db/tenant-context";
import { mobileSessions, organizationMembers, platformApiKeys } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { hashApiKey, secureHashEquals } from "@/lib/security/encryption";

export type ApiScope =
  | "agents:read" | "agents:write"
  | "chat:write"
  | "conversations:read" | "conversations:write"
  | "events:read" | "events:write"
  | "files:read" | "files:write"
  | "runs:read" | "runs:write"
  | "integrations:read" | "integrations:write"
  | "providers:read" | "providers:write"
  | "github:read"
  | "mcp:read" | "mcp:write"
  | "teams:read" | "teams:write";

export const ALL_API_SCOPES = [
  "agents:read", "agents:write", "chat:write", "conversations:read", "conversations:write",
  "events:read", "events:write", "files:read", "files:write", "runs:read", "runs:write",
  "integrations:read", "integrations:write", "providers:read", "providers:write", "github:read",
  "mcp:read", "mcp:write", "teams:read", "teams:write",
] as const satisfies readonly ApiScope[];

const apiScopeSet = new Set<string>(ALL_API_SCOPES);

export function normalizeApiScopes(scopes: readonly string[]): ApiScope[] {
  return [...new Set(scopes.filter((scope): scope is ApiScope => apiScopeSet.has(scope)))];
}

export type ApiPrincipal = {
  organizationId: string;
  apiKeyId: string;
  principalId: string;
  kind: "api_key" | "mobile_session";
  userId: string | null;
  role: string | null;
  scopes: ApiScope[];
};

async function resolveApiPrincipal(request: Request): Promise<ApiPrincipal | null> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  if (!token) return null;

  const tokenHash = hashApiKey(token);
  const [key] = await db()
    .select()
    .from(platformApiKeys)
    .where(eq(platformApiKeys.keyHash, tokenHash))
    .limit(1);

  if (key && !key.revoked && (!key.expiresAt || key.expiresAt > new Date())) {
    const staleBefore = new Date(Date.now() - 15 * 60_000);
    await db().update(platformApiKeys).set({ lastUsedAt: new Date() }).where(and(
      eq(platformApiKeys.id, key.id),
      or(isNull(platformApiKeys.lastUsedAt), lt(platformApiKeys.lastUsedAt, staleBefore)),
    ));
    return {
      organizationId: key.organizationId,
      apiKeyId: key.id,
      principalId: key.id,
      kind: "api_key",
      userId: key.createdByUserId,
      role: null,
      scopes: normalizeApiScopes(key.scopes),
    };
  }

  const [mobile] = await db().select({
    id: mobileSessions.id,
    userId: mobileSessions.userId,
    organizationId: mobileSessions.organizationId,
    lastUsedAt: mobileSessions.lastUsedAt,
    role: organizationMembers.role,
  }).from(mobileSessions)
    .innerJoin(organizationMembers, and(
      eq(organizationMembers.userId, mobileSessions.userId),
      eq(organizationMembers.organizationId, mobileSessions.organizationId),
    ))
    .where(and(
      eq(mobileSessions.accessTokenHash, tokenHash),
      isNull(mobileSessions.revokedAt),
      gt(mobileSessions.accessExpiresAt, new Date()),
    ))
    .limit(1);
  if (!mobile) return null;
  const mobileScopes = mobile.role === "owner" || mobile.role === "admin"
    ? ["agents:read", "agents:write", "chat:write", "conversations:read", "conversations:write", "events:read", "events:write", "files:read", "files:write", "runs:read", "runs:write", "integrations:read", "integrations:write", "providers:read", "providers:write", "mcp:read", "mcp:write", "teams:read", "teams:write"]
    : mobile.role === "developer"
      ? ["agents:read", "agents:write", "chat:write", "conversations:read", "conversations:write", "events:read", "events:write", "files:read", "files:write", "runs:read", "runs:write", "integrations:read", "providers:read", "mcp:read", "teams:read"]
      : ["agents:read", "chat:write", "conversations:read", "conversations:write", "events:read", "files:read", "files:write", "runs:read", "runs:write", "teams:read"];
  if (mobile.lastUsedAt < new Date(Date.now() - 15 * 60_000)) {
    await db().update(mobileSessions).set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(mobileSessions.id, mobile.id));
  }
  return {
    organizationId: mobile.organizationId,
    apiKeyId: mobile.id,
    principalId: mobile.id,
    kind: "mobile_session",
    userId: mobile.userId,
    role: mobile.role,
    scopes: mobileScopes as ApiScope[],
  };
}

export async function authenticateApiKey(request: Request): Promise<ApiPrincipal | null> {
  const principal = await runWithSystemDatabaseContext(() => resolveApiPrincipal(request));
  if (principal) enterTenantDatabaseContext(principal.organizationId, principal.userId);
  return principal;
}

export function requireApiScope(principal: ApiPrincipal, scope: ApiScope) {
  if (!principal.scopes.includes(scope)) {
    throw new ApiError(403, "API_SCOPE_FORBIDDEN", "لا يملك هذا الرمز الصلاحية المطلوبة.");
  }
}

export function bootstrapAuthorized(request: Request): boolean {
  const configured = process.env.BOOTSTRAP_ADMIN_TOKEN;
  const supplied = request.headers.get("x-bootstrap-token");
  return Boolean(configured && supplied && secureHashEquals(hashApiKey(configured), supplied));
}
