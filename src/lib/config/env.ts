type NodeEnvironment = "development" | "test" | "production";
type LogLevel = "debug" | "info" | "warn" | "error";

type RuntimeEnvironment = {
  nodeEnv: NodeEnvironment;
  databaseUrl: string;
  credentialEncryptionKey: string;
  credentialEncryptionKeyId: string;
  credentialEncryptionPreviousKeys: Readonly<Record<string, string>>;
  bootstrapAdminToken?: string;
  appUrl?: string;
  logLevel: LogLevel;
  browserAgentEnabled: boolean;
  googleOauthIntegrationsEnabled: boolean;
  browserInteractiveLoginEnabled: boolean;
  browserScreenshotsEnabled: boolean;
  browserRunnerUrl?: string;
  browserRunnerSharedSecret?: string;
  browserWorkerConcurrency: number;
  browserTaskTimeoutMs: number;
  browserMaxSteps: number;
  browserMaxPages: number;
  browserAllowedDownloadBytes: number;
  browserArtifactRetentionDays: number;
  googleOauthClientId?: string;
  googleOauthClientSecret?: string;
  googleOauthRedirectUri?: string;
  sandboxEnabled: boolean;
  sandboxRunnerUrl?: string;
  sandboxRunnerSharedSecret?: string;
  sandboxExecutionTimeoutMs: number;
  sandboxMaxOutputBytes: number;
  sandboxMaxFileBytes: number;
  sandboxWorkspaceDiskBytes: number;
  sandboxMaxConcurrentPerOrganization: number;
  sandboxArtifactRetentionDays: number;
};

let cached: RuntimeEnvironment | null = null;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function parseNodeEnvironment(value: string | undefined): NodeEnvironment {
  const candidate = value ?? "development";
  if (candidate === "development" || candidate === "test" || candidate === "production") return candidate;
  throw new Error("NODE_ENV must be development, test, or production.");
}

function parseLogLevel(value: string | undefined): LogLevel {
  const candidate = value ?? "info";
  if (candidate === "debug" || candidate === "info" || candidate === "warn" || candidate === "error") return candidate;
  throw new Error("LOG_LEVEL must be debug, info, warn, or error.");
}

function booleanEnv(name: string, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function integerEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function validateEncryptionKey(value: string): string {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte value.");
  return value;
}

function encryptionKeyId(value: string | undefined): string {
  const id = value?.trim() || "primary";
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error("CREDENTIAL_ENCRYPTION_KEY_ID is invalid.");
  return id;
}

function previousEncryptionKeys(value: string | undefined): Readonly<Record<string, string>> {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS must be valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS must be a key/value object.");
  }
  const keys: Record<string, string> = {};
  for (const [id, key] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || typeof key !== "string") {
      throw new Error("CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS contains an invalid entry.");
    }
    keys[id] = validateEncryptionKey(key);
  }
  return keys;
}

function serviceUrl(name: string, nodeEnv: NodeEnvironment): string | undefined {
  const value = optional(name);
  if (!value) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid URL.`); }
  if (url.username || url.password || url.hash || url.search) {
    throw new Error(`${name} must not contain credentials, fragments, or query parameters.`);
  }
  if (nodeEnv === "production" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS in production.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  return url.toString().replace(/\/$/, "");
}

export function env(): RuntimeEnvironment {
  if (cached) return cached;

  const nodeEnv = parseNodeEnvironment(process.env.NODE_ENV);
  const appUrl = optional("APP_URL");
  if (nodeEnv === "production" && !appUrl) {
    throw new Error("APP_URL is required in production.");
  }
  if (nodeEnv === "production" && appUrl && !appUrl.startsWith("https://")) {
    throw new Error("APP_URL must use HTTPS in production.");
  }

  const browserAgentEnabled = booleanEnv("BROWSER_AGENT_ENABLED");
  const googleOauthIntegrationsEnabled = booleanEnv("GOOGLE_OAUTH_INTEGRATIONS_ENABLED");
  const browserInteractiveLoginEnabled = booleanEnv("BROWSER_INTERACTIVE_LOGIN_ENABLED");
  const browserScreenshotsEnabled = booleanEnv("BROWSER_SCREENSHOTS_ENABLED");
  const sandboxEnabled = booleanEnv("SANDBOX_ENABLED");
  const browserRunnerUrl = serviceUrl("BROWSER_RUNNER_URL", nodeEnv);
  const sandboxRunnerUrl = serviceUrl("SANDBOX_RUNNER_URL", nodeEnv);
  const browserRunnerSharedSecret = optional("BROWSER_RUNNER_SHARED_SECRET");
  const sandboxRunnerSharedSecret = optional("SANDBOX_RUNNER_SHARED_SECRET");
  const googleOauthClientId = optional("GOOGLE_OAUTH_CLIENT_ID");
  const googleOauthClientSecret = optional("GOOGLE_OAUTH_CLIENT_SECRET");
  const googleOauthRedirectUri = optional("GOOGLE_OAUTH_REDIRECT_URI");

  if (browserInteractiveLoginEnabled && !browserAgentEnabled) {
    throw new Error("BROWSER_INTERACTIVE_LOGIN_ENABLED requires BROWSER_AGENT_ENABLED.");
  }
  if (browserAgentEnabled && (!browserRunnerUrl || !browserRunnerSharedSecret)) {
    throw new Error("BROWSER_RUNNER_URL and BROWSER_RUNNER_SHARED_SECRET are required when browser agents are enabled.");
  }
  if (googleOauthIntegrationsEnabled && (!googleOauthClientId || !googleOauthClientSecret || !googleOauthRedirectUri)) {
    throw new Error("Google OAuth integration variables are required when GOOGLE_OAUTH_INTEGRATIONS_ENABLED is true.");
  }
  if (googleOauthRedirectUri) {
    let redirect: URL;
    try { redirect = new URL(googleOauthRedirectUri); } catch { throw new Error("GOOGLE_OAUTH_REDIRECT_URI must be a valid URL."); }
    if (nodeEnv === "production" && redirect.protocol !== "https:") {
      throw new Error("GOOGLE_OAUTH_REDIRECT_URI must use HTTPS in production.");
    }
  }
  if (sandboxEnabled && (!sandboxRunnerUrl || !sandboxRunnerSharedSecret)) {
    throw new Error("SANDBOX_RUNNER_URL and SANDBOX_RUNNER_SHARED_SECRET are required when SANDBOX_ENABLED is true.");
  }
  if (browserRunnerSharedSecret && browserRunnerSharedSecret.length < 32) {
    throw new Error("BROWSER_RUNNER_SHARED_SECRET must contain at least 32 characters.");
  }
  if (sandboxRunnerSharedSecret && sandboxRunnerSharedSecret.length < 32) {
    throw new Error("SANDBOX_RUNNER_SHARED_SECRET must contain at least 32 characters.");
  }

  const config: RuntimeEnvironment = {
    nodeEnv,
    databaseUrl: required("DATABASE_URL"),
    credentialEncryptionKey: validateEncryptionKey(required("CREDENTIAL_ENCRYPTION_KEY")),
    credentialEncryptionKeyId: encryptionKeyId(process.env.CREDENTIAL_ENCRYPTION_KEY_ID),
    credentialEncryptionPreviousKeys: previousEncryptionKeys(process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS),
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
    browserAgentEnabled,
    googleOauthIntegrationsEnabled,
    browserInteractiveLoginEnabled,
    browserScreenshotsEnabled,
    browserWorkerConcurrency: integerEnv("BROWSER_WORKER_CONCURRENCY", 1, 1, 10),
    browserTaskTimeoutMs: integerEnv("BROWSER_TASK_TIMEOUT_MS", 300_000, 10_000, 1_800_000),
    browserMaxSteps: integerEnv("BROWSER_MAX_STEPS", 50, 1, 100),
    browserMaxPages: integerEnv("BROWSER_MAX_PAGES", 5, 1, 10),
    browserAllowedDownloadBytes: integerEnv("BROWSER_ALLOWED_DOWNLOAD_BYTES", 10_485_760, 1_024, 104_857_600),
    browserArtifactRetentionDays: integerEnv("BROWSER_ARTIFACT_RETENTION_DAYS", 7, 1, 90),
    sandboxEnabled,
    sandboxExecutionTimeoutMs: integerEnv("SANDBOX_EXECUTION_TIMEOUT_MS", 300_000, 1_000, 1_800_000),
    sandboxMaxOutputBytes: integerEnv("SANDBOX_MAX_OUTPUT_BYTES", 2_097_152, 1_024, 20_971_520),
    sandboxMaxFileBytes: integerEnv("SANDBOX_MAX_FILE_BYTES", 10_485_760, 1_024, 104_857_600),
    sandboxWorkspaceDiskBytes: integerEnv("SANDBOX_WORKSPACE_DISK_BYTES", 536_870_912, 10_485_760, 10_737_418_240),
    sandboxMaxConcurrentPerOrganization: integerEnv("SANDBOX_MAX_CONCURRENT_PER_ORG", 2, 1, 20),
    sandboxArtifactRetentionDays: integerEnv("SANDBOX_ARTIFACT_RETENTION_DAYS", 7, 1, 90),
  };

  const bootstrapAdminToken = optional("BOOTSTRAP_ADMIN_TOKEN");
  if (bootstrapAdminToken) config.bootstrapAdminToken = bootstrapAdminToken;
  if (appUrl) config.appUrl = appUrl;
  if (browserRunnerUrl) config.browserRunnerUrl = browserRunnerUrl;
  if (browserRunnerSharedSecret) config.browserRunnerSharedSecret = browserRunnerSharedSecret;
  if (sandboxRunnerUrl) config.sandboxRunnerUrl = sandboxRunnerUrl;
  if (sandboxRunnerSharedSecret) config.sandboxRunnerSharedSecret = sandboxRunnerSharedSecret;
  if (googleOauthClientId) config.googleOauthClientId = googleOauthClientId;
  if (googleOauthClientSecret) config.googleOauthClientSecret = googleOauthClientSecret;
  if (googleOauthRedirectUri) config.googleOauthRedirectUri = googleOauthRedirectUri;

  cached = config;
  return config;
}

export function resetEnvForTests() {
  cached = null;
}
