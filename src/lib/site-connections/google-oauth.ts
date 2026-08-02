import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { siteOauthStates } from "@/db/site-oauth-schema";
import { siteConnections } from "@/db/site-connections-schema";
import { auditLogs } from "@/db/schema";
import { env } from "@/lib/config/env";
import { ApiError } from "@/lib/http/api";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const GOOGLE_JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_SCOPES = ["openid", "email", "profile"] as const;
const STATE_TTL_MS = 10 * 60_000;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
  id_token: z.string().min(1),
}).passthrough();

const refreshResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
  id_token: z.string().optional(),
}).passthrough();

const jwtHeaderSchema = z.object({
  alg: z.literal("RS256"),
  kid: z.string().min(1).max(200),
  typ: z.string().optional(),
}).passthrough();

const jwtClaimsSchema = z.object({
  iss: z.enum(["https://accounts.google.com", "accounts.google.com"]),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number().int(),
  iat: z.number().int().optional(),
  nonce: z.string().min(1),
  sub: z.string().min(1),
  email: z.string().email().optional(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
  picture: z.string().url().optional(),
}).passthrough();

const jwksSchema = z.object({
  keys: z.array(z.object({
    kty: z.string(),
    kid: z.string(),
    use: z.string().optional(),
    alg: z.string().optional(),
    n: z.string().optional(),
    e: z.string().optional(),
  }).passthrough()),
}).strict();

type StoredGoogleTokens = {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt: string;
};

function oauthConfig() {
  const config = env();
  if (!config.googleOauthIntegrationsEnabled
    || !config.googleOauthClientId
    || !config.googleOauthClientSecret
    || !config.googleOauthRedirectUri) {
    throw new ApiError(404, "FEATURE_DISABLED", "تكامل Google OAuth غير مفعّل.");
  }
  return {
    clientId: config.googleOauthClientId,
    clientSecret: config.googleOauthClientSecret,
    redirectUri: config.googleOauthRedirectUri,
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function decodeJsonPart<T>(value: string, schema: z.ZodType<T>): T {
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); }
  catch { throw new ApiError(422, "GOOGLE_ID_TOKEN_INVALID", "رمز هوية Google غير صالح."); }
  return schema.parse(decoded);
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, redirect: "error", cache: "no-store", signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(422, "GOOGLE_OAUTH_REJECTED", "رفض Google طلب OAuth.", { googleStatus: response.status });
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "GOOGLE_OAUTH_TIMEOUT", "انتهت مهلة الاتصال بخدمة Google OAuth.");
    }
    throw new ApiError(502, "GOOGLE_OAUTH_UNAVAILABLE", "تعذر الاتصال بخدمة Google OAuth.");
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyGoogleIdToken(idToken: string, expectedNonceHash: string) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new ApiError(422, "GOOGLE_ID_TOKEN_INVALID", "رمز هوية Google غير صالح.");
  const header = decodeJsonPart(parts[0]!, jwtHeaderSchema);
  const claims = decodeJsonPart(parts[1]!, jwtClaimsSchema);
  const config = oauthConfig();
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.clientId)) {
    throw new ApiError(422, "GOOGLE_ID_TOKEN_AUDIENCE", "رمز Google موجّه إلى عميل OAuth آخر.");
  }
  if (claims.exp * 1000 <= Date.now() - 60_000) {
    throw new ApiError(422, "GOOGLE_ID_TOKEN_EXPIRED", "انتهت صلاحية رمز هوية Google.");
  }
  const nonceHash = Buffer.from(sha256(claims.nonce));
  const expected = Buffer.from(expectedNonceHash);
  if (nonceHash.length !== expected.length || !timingSafeEqual(nonceHash, expected)) {
    throw new ApiError(403, "GOOGLE_OAUTH_NONCE_MISMATCH", "فشل التحقق من nonce الخاص بطلب Google OAuth.");
  }

  const jwks = jwksSchema.parse(await fetchJson(GOOGLE_JWKS_ENDPOINT, { method: "GET", headers: { accept: "application/json" } }));
  const jwk = jwks.keys.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA");
  if (!jwk) throw new ApiError(422, "GOOGLE_ID_TOKEN_KEY_UNKNOWN", "تعذر التحقق من مفتاح توقيع Google.");
  const key = createPublicKey({ key: jwk as JsonWebKey, format: "jwk" });
  const valid = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`, "utf8"),
    key,
    Buffer.from(parts[2]!, "base64url"),
  );
  if (!valid) throw new ApiError(422, "GOOGLE_ID_TOKEN_SIGNATURE", "توقيع رمز هوية Google غير صالح.");
  return claims;
}

export async function beginGoogleOAuth(input: {
  organizationId: string;
  userId: string;
  name: string;
  requestId: string;
}) {
  const config = oauthConfig();
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = sha256(codeVerifier);
  const connectionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);

  await db().transaction(async (tx) => {
    await tx.insert(siteConnections).values({
      id: connectionId,
      organizationId: input.organizationId,
      createdByUserId: input.userId,
      name: input.name,
      siteDomain: "google.com",
      connectorType: "oauth",
      connectorKey: "google",
      status: "pending",
      grantedScopes: [],
      allowedDomains: ["accounts.google.com", "oauth2.googleapis.com", "www.googleapis.com"],
      metadata: {},
    });
    await tx.insert(siteOauthStates).values({
      organizationId: input.organizationId,
      userId: input.userId,
      siteConnectionId: connectionId,
      provider: "google",
      stateHash: sha256(state),
      nonceHash: sha256(nonce),
      encryptedCodeVerifier: encryptSecret(codeVerifier, `google-oauth:${input.organizationId}:${connectionId}`),
      redirectUri: config.redirectUri,
      requestedScopes: GOOGLE_SCOPES.join(" "),
      expiresAt,
    });
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      action: "site_connection.oauth_started",
      resourceType: "site_connection",
      resourceId: connectionId,
      metadata: { provider: "google", scopes: GOOGLE_SCOPES, requestId: input.requestId },
    });
  });

  const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  authorizationUrl.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
  }).toString();
  return { connectionId, authorizationUrl, expiresAt };
}

export async function completeGoogleOAuth(input: {
  organizationId: string;
  userId: string;
  state: string;
  code: string;
  requestId: string;
}) {
  const config = oauthConfig();
  const now = new Date();
  const [stateRow] = await db().select().from(siteOauthStates).where(and(
    eq(siteOauthStates.organizationId, input.organizationId),
    eq(siteOauthStates.userId, input.userId),
    eq(siteOauthStates.provider, "google"),
    eq(siteOauthStates.stateHash, sha256(input.state)),
    isNull(siteOauthStates.consumedAt),
    gt(siteOauthStates.expiresAt, now),
  )).limit(1);
  if (!stateRow) throw new ApiError(403, "GOOGLE_OAUTH_STATE_MISMATCH", "حالة Google OAuth غير صالحة أو منتهية.");
  if (stateRow.redirectUri !== config.redirectUri) {
    throw new ApiError(403, "GOOGLE_OAUTH_REDIRECT_MISMATCH", "عنوان إعادة Google OAuth لا يطابق الإعداد الموثوق.");
  }
  const [consumed] = await db().update(siteOauthStates).set({ consumedAt: now }).where(and(
    eq(siteOauthStates.id, stateRow.id),
    isNull(siteOauthStates.consumedAt),
  )).returning({ id: siteOauthStates.id });
  if (!consumed) throw new ApiError(409, "GOOGLE_OAUTH_STATE_CONSUMED", "استُخدمت حالة Google OAuth مسبقًا.");

  const codeVerifier = decryptSecret(
    stateRow.encryptedCodeVerifier,
    `google-oauth:${input.organizationId}:${stateRow.siteConnectionId}`,
  );
  const tokenPayload = tokenResponseSchema.parse(await fetchJson(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: input.code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
  }));
  const claims = await verifyGoogleIdToken(tokenPayload.id_token, stateRow.nonceHash);
  const expiresAt = new Date(Date.now() + tokenPayload.expires_in * 1000);
  const storedTokens: StoredGoogleTokens = {
    accessToken: tokenPayload.access_token,
    ...(tokenPayload.refresh_token ? { refreshToken: tokenPayload.refresh_token } : {}),
    tokenType: tokenPayload.token_type ?? "Bearer",
    expiresAt: expiresAt.toISOString(),
  };
  const grantedScopes = (tokenPayload.scope ?? stateRow.requestedScopes).split(/\s+/).filter(Boolean);

  const [connection] = await db().update(siteConnections).set({
    encryptedCredentials: encryptSecret(
      JSON.stringify(storedTokens),
      `site-connection:${input.organizationId}:${stateRow.siteConnectionId}`,
    ),
    credentialKeyId: env().credentialEncryptionKeyId,
    credentialHint: claims.email ? `Google: ${claims.email}` : "Google OAuth",
    grantedScopes,
    metadata: {
      subject: claims.sub,
      email: claims.email ?? null,
      emailVerified: claims.email_verified ?? false,
      name: claims.name ?? null,
      picture: claims.picture ?? null,
    },
    status: "verified",
    lastVerifiedAt: now,
    expiresAt,
    updatedAt: now,
  }).where(and(
    eq(siteConnections.id, stateRow.siteConnectionId),
    eq(siteConnections.organizationId, input.organizationId),
    eq(siteConnections.status, "pending"),
  )).returning({ id: siteConnections.id, name: siteConnections.name });
  if (!connection) throw new ApiError(404, "SITE_CONNECTION_NOT_FOUND", "اتصال Google غير موجود.");
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.userId,
    action: "site_connection.oauth_completed",
    resourceType: "site_connection",
    resourceId: connection.id,
    metadata: { provider: "google", scopes: grantedScopes, requestId: input.requestId },
  });
  return connection;
}

export async function refreshGoogleTokens(input: { organizationId: string; connectionId: string }) {
  const config = oauthConfig();
  const [connection] = await db().select().from(siteConnections).where(and(
    eq(siteConnections.id, input.connectionId),
    eq(siteConnections.organizationId, input.organizationId),
    eq(siteConnections.connectorKey, "google"),
    eq(siteConnections.status, "verified"),
  )).limit(1);
  if (!connection?.encryptedCredentials) throw new ApiError(409, "GOOGLE_CONNECTION_UNAVAILABLE", "اتصال Google غير متاح.");
  const tokens = JSON.parse(decryptSecret(
    connection.encryptedCredentials,
    `site-connection:${input.organizationId}:${connection.id}`,
  )) as StoredGoogleTokens;
  if (new Date(tokens.expiresAt).getTime() > Date.now() + 60_000) return tokens;
  if (!tokens.refreshToken) throw new ApiError(409, "GOOGLE_REFRESH_TOKEN_MISSING", "يتطلب اتصال Google إعادة مصادقة.");
  const payload = refreshResponseSchema.parse(await fetchJson(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    }),
  }));
  const refreshed: StoredGoogleTokens = {
    accessToken: payload.access_token,
    refreshToken: tokens.refreshToken,
    tokenType: payload.token_type ?? tokens.tokenType,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
  };
  await db().update(siteConnections).set({
    encryptedCredentials: encryptSecret(JSON.stringify(refreshed), `site-connection:${input.organizationId}:${connection.id}`),
    grantedScopes: payload.scope ? payload.scope.split(/\s+/).filter(Boolean) : connection.grantedScopes,
    expiresAt: new Date(refreshed.expiresAt),
    updatedAt: new Date(),
  }).where(and(eq(siteConnections.id, connection.id), eq(siteConnections.organizationId, input.organizationId)));
  return refreshed;
}

export async function revokeGoogleConnection(input: {
  organizationId: string;
  userId: string;
  connectionId: string;
  requestId: string;
}) {
  const [connection] = await db().select().from(siteConnections).where(and(
    eq(siteConnections.id, input.connectionId),
    eq(siteConnections.organizationId, input.organizationId),
    eq(siteConnections.connectorKey, "google"),
  )).limit(1);
  if (!connection) throw new ApiError(404, "SITE_CONNECTION_NOT_FOUND", "اتصال Google غير موجود.");
  if (connection.encryptedCredentials) {
    const tokens = JSON.parse(decryptSecret(
      connection.encryptedCredentials,
      `site-connection:${input.organizationId}:${connection.id}`,
    )) as StoredGoogleTokens;
    const token = tokens.refreshToken ?? tokens.accessToken;
    const response = await fetch(`${GOOGLE_REVOKE_ENDPOINT}?${new URLSearchParams({ token })}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok && response.status !== 400) {
      throw new ApiError(502, "GOOGLE_REVOKE_FAILED", "تعذر سحب تفويض Google.");
    }
  }
  const now = new Date();
  await db().transaction(async (tx) => {
    await tx.update(siteConnections).set({
      status: "revoked",
      encryptedCredentials: null,
      encryptedSessionState: null,
      grantedScopes: [],
      expiresAt: null,
      revokedAt: now,
      updatedAt: now,
    }).where(and(
      eq(siteConnections.id, connection.id),
      eq(siteConnections.organizationId, input.organizationId),
    ));
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      action: "site_connection.revoked",
      resourceType: "site_connection",
      resourceId: connection.id,
      metadata: { provider: "google", requestId: input.requestId },
    });
  });
  return { revoked: true, id: connection.id };
}
