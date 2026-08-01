import { randomBytes, timingSafeEqual } from "node:crypto";
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mcpServers } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";

export const HIGGSFIELD_MCP_ENDPOINT = "https://mcp.higgsfield.ai/mcp";
export const HIGGSFIELD_OAUTH_SCOPES = "openid email offline_access";
export const DEFAULT_APP_URL = "https://moatazalalqami.online";

type StoredOAuthData = {
  redirectUri: string;
  state?: string;
  codeVerifier?: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  discoveryState?: OAuthDiscoveryState;
};

type OAuthServerRow = Pick<
  typeof mcpServers.$inferSelect,
  "id" | "organizationId" | "endpoint" | "encryptedOauthData"
>;

function parseStoredData(server: OAuthServerRow, redirectUri: string): StoredOAuthData {
  if (!server.encryptedOauthData) return { redirectUri };
  const parsed = JSON.parse(decryptSecret(server.encryptedOauthData, `mcp-oauth:${server.organizationId}`)) as StoredOAuthData;
  return { ...parsed, redirectUri: parsed.redirectUri || redirectUri };
}

function equalSecret(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function publicAppUrl() {
  const configured = process.env.APP_URL?.trim() || DEFAULT_APP_URL;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password) return DEFAULT_APP_URL;
    return url.origin;
  } catch {
    return DEFAULT_APP_URL;
  }
}

export function isOfficialHiggsfieldEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:"
      && url.hostname === "mcp.higgsfield.ai"
      && url.pathname.replace(/\/+$/, "") === "/mcp"
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export class DatabaseMcpOAuthProvider implements OAuthClientProvider {
  private data: StoredOAuthData;
  private pendingAuthorizationUrl: URL | null = null;

  constructor(private readonly server: OAuthServerRow, redirectUri: string) {
    if (!isOfficialHiggsfieldEndpoint(server.endpoint)) {
      throw new Error("MCP_OAUTH_SERVER_NOT_ALLOWED");
    }
    this.data = parseStoredData(server, redirectUri);
  }

  get redirectUrl() {
    return this.data.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Moataz AI",
      client_uri: publicAppUrl(),
      redirect_uris: [this.data.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: HIGGSFIELD_OAUTH_SCOPES,
      software_id: "moataz-ai-higgsfield-mcp",
      software_version: "1.3.0",
    };
  }

  async state() {
    this.data.state = randomBytes(32).toString("base64url");
    await this.persist();
    return this.data.state;
  }

  clientInformation() {
    return this.data.clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    this.data.clientInformation = clientInformation;
    await this.persist();
  }

  tokens() {
    return this.data.tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    this.data.tokens = {
      ...tokens,
      refresh_token: tokens.refresh_token ?? this.data.tokens?.refresh_token,
    };
    this.data.codeVerifier = undefined;
    this.data.state = undefined;
    await this.persist(true);
  }

  redirectToAuthorization(authorizationUrl: URL) {
    this.pendingAuthorizationUrl = authorizationUrl;
  }

  async saveCodeVerifier(codeVerifier: string) {
    this.data.codeVerifier = codeVerifier;
    await this.persist();
  }

  codeVerifier() {
    if (!this.data.codeVerifier) throw new Error("MCP_OAUTH_CODE_VERIFIER_MISSING");
    return this.data.codeVerifier;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState) {
    this.data.discoveryState = state;
    await this.persist();
  }

  discoveryState() {
    return this.data.discoveryState;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "client") this.data.clientInformation = undefined;
    if (scope === "all" || scope === "tokens") this.data.tokens = undefined;
    if (scope === "all" || scope === "verifier") {
      this.data.codeVerifier = undefined;
      this.data.state = undefined;
    }
    if (scope === "all" || scope === "discovery") this.data.discoveryState = undefined;
    await this.persist();
  }

  authorizationUrl() {
    return this.pendingAuthorizationUrl?.toString() ?? null;
  }

  verifyState(value: string) {
    return Boolean(this.data.state && equalSecret(this.data.state, value));
  }

  private async persist(connected = false) {
    const expiresIn = this.data.tokens?.expires_in;
    const oauthExpiresAt = expiresIn
      ? new Date(Date.now() + Math.max(0, expiresIn - 30) * 1_000)
      : null;
    await db().update(mcpServers).set({
      encryptedOauthData: encryptSecret(JSON.stringify(this.data), `mcp-oauth:${this.server.organizationId}`),
      oauthScopes: this.data.tokens?.scope ?? HIGGSFIELD_OAUTH_SCOPES,
      oauthExpiresAt,
      ...(connected ? {
        oauthConnectedAt: new Date(),
        tokenHint: "OAuth 2.1",
        status: "connected",
      } : {}),
      updatedAt: new Date(),
    }).where(and(
      eq(mcpServers.id, this.server.id),
      eq(mcpServers.organizationId, this.server.organizationId),
    ));
  }
}
