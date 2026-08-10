type NodeEnvironment = "development" | "test" | "production";
type LogLevel = "debug" | "info" | "warn" | "error";
type ExecutionRunnerKind = "existing" | "gvisor" | "e2b" | "daytona";

type RuntimeEnvironment = {
  nodeEnv: NodeEnvironment;
  databaseUrl: string;
  credentialEncryptionKey: string;
  credentialEncryptionKeyId: string;
  credentialEncryptionPreviousKeys: Readonly<Record<string, string>>;
  bootstrapAdminToken?: string;
  appUrl?: string;
  publicAppUrl?: string;
  whatsappIntegrationEnabled: boolean;
  metaAppId?: string;
  metaAppSecret?: string;
  metaGraphApiVersion?: string;
  whatsappAccessToken?: string;
  whatsappPhoneNumberId?: string;
  whatsappBusinessAccountId?: string;
  whatsappDisplayPhoneNumber?: string;
  whatsappWebhookVerifyToken?: string;
  whatsappConnectTokenSecret?: string;
  whatsappConnectTokenTtlMinutes: number;
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
  executionKernelEnabled: boolean;
  executionRunner: ExecutionRunnerKind;
  executionDefaultTimeoutMs: number;
  executionDefaultMemoryBytes: number;
  executionDefaultDiskBytes: number;
  executionDefaultMaxProcesses: number;
  executionDefaultMaxOutputBytes: number;
  executionDefaultMaxArtifactBytes: number;
  executionDefaultNetworkMode: "deny_all" | "allowlist";
  executionWorkspaceTtlSeconds: number;
  executionHeartbeatIntervalSeconds: number;
  executionLeaseTtlSeconds: number;
  executionReconcileIntervalSeconds: number;
  executionE2bEnabled: boolean;
  e2bApiKey?: string;
  executionDaytonaEnabled: boolean;
  daytonaApiKey?: string;
  executionGvisorEnabled: boolean;
  executionGvisorRuntime: string;
  executionCredentialBrokerEnabled: boolean;
  executionCredentialGrantTtlSeconds: number;
  executionProxySharedSecret?: string;
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

function executionRunner(value: string | undefined): ExecutionRunnerKind {
  const candidate = value?.trim() || "existing";
  if (candidate === "existing" || candidate === "gvisor" || candidate === "e2b" || candidate === "daytona") return candidate;
  throw new Error("EXECUTION_RUNNER must be existing, gvisor, e2b, or daytona.");
}

function executionNetworkMode(value: string | undefined): "deny_all" | "allowlist" {
  const candidate = value?.trim() || "deny_all";
  if (candidate === "deny_all" || candidate === "allowlist") return candidate;
  throw new Error("EXECUTION_DEFAULT_NETWORK_MODE must be deny_all or allowlist.");
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
  if (nodeEnv === "production" && url.protocol !== "https:") throw new Error(`${name} must use HTTPS in production.`);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} must use HTTP or HTTPS.`);
  return url.toString().replace(/\/$/, "");
}

function requireFeatureValue(enabled: boolean, name: string) {
  const value = optional(name);
  if (enabled && !value) throw new Error(`${name} is required when WHATSAPP_INTEGRATION_ENABLED is true.`);
  return value;
}

function numericIdentifier(name: string, value: string | undefined) {
  if (!value) return undefined;
  if (!/^\d{5,30}$/.test(value)) throw new Error(`${name} must contain digits only.`);
  return value;
}

function graphApiVersion(value: string | undefined) {
  if (!value) return undefined;
  if (!/^v\d{1,3}\.\d{1,2}$/.test(value)) throw new Error("META_GRAPH_API_VERSION must look like v23.0.");
  return value;
}

function displayPhoneNumber(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.replace(/\D/g, "");
  if (!/^\d{8,20}$/.test(normalized)) throw new Error("WHATSAPP_DISPLAY_PHONE_NUMBER is invalid.");
  return normalized;
}

export function env(): RuntimeEnvironment {
  if (cached) return cached;
  const nodeEnv = parseNodeEnvironment(process.env.NODE_ENV);
  const appUrl = optional("APP_URL");
  if (nodeEnv === "production" && !appUrl) throw new Error("APP_URL is required in production.");
  if (nodeEnv === "production" && appUrl && !appUrl.startsWith("https://")) throw new Error("APP_URL must use HTTPS in production.");
  const publicAppUrl = serviceUrl("PUBLIC_APP_URL", nodeEnv) ?? appUrl;
  const whatsappIntegrationEnabled = booleanEnv("WHATSAPP_INTEGRATION_ENABLED");
  const metaAppId = numericIdentifier("META_APP_ID", requireFeatureValue(whatsappIntegrationEnabled, "META_APP_ID"));
  const metaAppSecret = requireFeatureValue(whatsappIntegrationEnabled, "META_APP_SECRET");
  const metaGraphApiVersion = graphApiVersion(requireFeatureValue(whatsappIntegrationEnabled, "META_GRAPH_API_VERSION"));
  const whatsappAccessToken = requireFeatureValue(whatsappIntegrationEnabled, "WHATSAPP_ACCESS_TOKEN");
  const whatsappPhoneNumberId = numericIdentifier("WHATSAPP_PHONE_NUMBER_ID", requireFeatureValue(whatsappIntegrationEnabled, "WHATSAPP_PHONE_NUMBER_ID"));
  const whatsappBusinessAccountId = numericIdentifier("WHATSAPP_BUSINESS_ACCOUNT_ID", requireFeatureValue(whatsappIntegrationEnabled, "WHATSAPP_BUSINESS_ACCOUNT_ID"));
  const whatsappDisplayPhoneNumber = displayPhoneNumber(requireFeatureValue(whatsappIntegrationEnabled, "WHATSAPP_DISPLAY_PHONE_NUMBER"));
  const whatsappWebhookVerifyToken = requireFeatureValue(whatsappIntegrationEnabled, "WHATSAPP_WEBHOOK_VERIFY_TOKEN");
  const whatsappConnectTokenSecret = requireFeatureValue(whatsappIntegrationEnabled, "WHATSAPP_CONNECT_TOKEN_SECRET");
  const whatsappConnectTokenTtlMinutes = integerEnv("WHATSAPP_CONNECT_TOKEN_TTL_MINUTES", 10, 5, 60);

  if (whatsappIntegrationEnabled && !publicAppUrl) throw new Error("PUBLIC_APP_URL or APP_URL is required when WHATSAPP_INTEGRATION_ENABLED is true.");
  if (metaAppSecret && metaAppSecret.length < 16) throw new Error("META_APP_SECRET is too short.");
  if (whatsappAccessToken && whatsappAccessToken.length < 20) throw new Error("WHATSAPP_ACCESS_TOKEN is too short.");
  if (whatsappWebhookVerifyToken && whatsappWebhookVerifyToken.length < 16) throw new Error("WHATSAPP_WEBHOOK_VERIFY_TOKEN must contain at least 16 characters.");
  if (whatsappConnectTokenSecret && whatsappConnectTokenSecret.length < 32) throw new Error("WHATSAPP_CONNECT_TOKEN_SECRET must contain at least 32 characters.");

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

  if (browserInteractiveLoginEnabled && !browserAgentEnabled) throw new Error("BROWSER_INTERACTIVE_LOGIN_ENABLED requires BROWSER_AGENT_ENABLED.");
  if (browserAgentEnabled && (!browserRunnerUrl || !browserRunnerSharedSecret)) throw new Error("BROWSER_RUNNER_URL and BROWSER_RUNNER_SHARED_SECRET are required when browser agents are enabled.");
  if (googleOauthIntegrationsEnabled && (!googleOauthClientId || !googleOauthClientSecret || !googleOauthRedirectUri)) throw new Error("Google OAuth integration variables are required when GOOGLE_OAUTH_INTEGRATIONS_ENABLED is true.");
  if (googleOauthRedirectUri) {
    let redirect: URL;
    try { redirect = new URL(googleOauthRedirectUri); } catch { throw new Error("GOOGLE_OAUTH_REDIRECT_URI must be a valid URL."); }
    if (nodeEnv === "production" && redirect.protocol !== "https:") throw new Error("GOOGLE_OAUTH_REDIRECT_URI must use HTTPS in production.");
  }
  if (sandboxEnabled && (!sandboxRunnerUrl || !sandboxRunnerSharedSecret)) throw new Error("SANDBOX_RUNNER_URL and SANDBOX_RUNNER_SHARED_SECRET are required when SANDBOX_ENABLED is true.");
  if (browserRunnerSharedSecret && browserRunnerSharedSecret.length < 32) throw new Error("BROWSER_RUNNER_SHARED_SECRET must contain at least 32 characters.");
  if (sandboxRunnerSharedSecret && sandboxRunnerSharedSecret.length < 32) throw new Error("SANDBOX_RUNNER_SHARED_SECRET must contain at least 32 characters.");

  const executionKernelEnabled = booleanEnv("EXECUTION_KERNEL_ENABLED");
  const selectedExecutionRunner = executionRunner(process.env.EXECUTION_RUNNER);
  const executionE2bEnabled = booleanEnv("EXECUTION_E2B_ENABLED");
  const e2bApiKey = optional("E2B_API_KEY");
  const executionDaytonaEnabled = booleanEnv("EXECUTION_DAYTONA_ENABLED");
  const daytonaApiKey = optional("DAYTONA_API_KEY");
  const executionGvisorEnabled = booleanEnv("EXECUTION_GVISOR_ENABLED");
  const executionGvisorRuntime = optional("EXECUTION_GVISOR_RUNTIME") ?? "runsc";
  const executionCredentialBrokerEnabled = booleanEnv("EXECUTION_CREDENTIAL_BROKER_ENABLED", true);
  const executionProxySharedSecret = optional("EXECUTION_PROXY_SHARED_SECRET");
  if (executionE2bEnabled && !e2bApiKey) throw new Error("E2B_API_KEY is required when EXECUTION_E2B_ENABLED is true.");
  if (executionDaytonaEnabled && !daytonaApiKey) throw new Error("DAYTONA_API_KEY is required when EXECUTION_DAYTONA_ENABLED is true.");
  if (executionKernelEnabled && selectedExecutionRunner === "existing" && (!sandboxRunnerUrl || !sandboxRunnerSharedSecret)) {
    throw new Error("SANDBOX_RUNNER_URL and SANDBOX_RUNNER_SHARED_SECRET are required for EXECUTION_RUNNER=existing.");
  }
  if (executionKernelEnabled && selectedExecutionRunner === "e2b" && !executionE2bEnabled) throw new Error("EXECUTION_RUNNER=e2b requires EXECUTION_E2B_ENABLED=true.");
  if (executionKernelEnabled && selectedExecutionRunner === "daytona" && !executionDaytonaEnabled) throw new Error("EXECUTION_RUNNER=daytona requires EXECUTION_DAYTONA_ENABLED=true.");
  if (executionKernelEnabled && selectedExecutionRunner === "gvisor" && !executionGvisorEnabled) throw new Error("EXECUTION_RUNNER=gvisor requires EXECUTION_GVISOR_ENABLED=true.");
  if (executionKernelEnabled && selectedExecutionRunner === "gvisor" && process.env.RAILWAY_ENVIRONMENT) {
    throw new Error("gVisor/runsc requires a dedicated host and is not supported inside Railway.");
  }
  if (executionKernelEnabled && executionCredentialBrokerEnabled && (!executionProxySharedSecret || executionProxySharedSecret.length < 32)) {
    throw new Error("EXECUTION_PROXY_SHARED_SECRET with at least 32 characters is required when the execution credential broker is enabled.");
  }

  const config: RuntimeEnvironment = {
    nodeEnv,
    databaseUrl: required("DATABASE_URL"),
    credentialEncryptionKey: validateEncryptionKey(required("CREDENTIAL_ENCRYPTION_KEY")),
    credentialEncryptionKeyId: encryptionKeyId(process.env.CREDENTIAL_ENCRYPTION_KEY_ID),
    credentialEncryptionPreviousKeys: previousEncryptionKeys(process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS),
    whatsappIntegrationEnabled,
    whatsappConnectTokenTtlMinutes,
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
    executionKernelEnabled,
    executionRunner: selectedExecutionRunner,
    executionDefaultTimeoutMs: integerEnv("EXECUTION_DEFAULT_TIMEOUT_MS", 300_000, 1_000, 1_800_000),
    executionDefaultMemoryBytes: integerEnv("EXECUTION_DEFAULT_MEMORY_BYTES", 536_870_912, 67_108_864, 8_589_934_592),
    executionDefaultDiskBytes: integerEnv("EXECUTION_DEFAULT_DISK_BYTES", 1_073_741_824, 16_777_216, 21_474_836_480),
    executionDefaultMaxProcesses: integerEnv("EXECUTION_DEFAULT_MAX_PROCESSES", 64, 1, 512),
    executionDefaultMaxOutputBytes: integerEnv("EXECUTION_DEFAULT_MAX_OUTPUT_BYTES", 5_242_880, 1_024, 52_428_800),
    executionDefaultMaxArtifactBytes: integerEnv("EXECUTION_DEFAULT_MAX_ARTIFACT_BYTES", 104_857_600, 1_024, 2_147_483_648),
    executionDefaultNetworkMode: executionNetworkMode(process.env.EXECUTION_DEFAULT_NETWORK_MODE),
    executionWorkspaceTtlSeconds: integerEnv("EXECUTION_WORKSPACE_TTL_SECONDS", 1_800, 60, 86_400),
    executionHeartbeatIntervalSeconds: integerEnv("EXECUTION_HEARTBEAT_INTERVAL_SECONDS", 15, 5, 300),
    executionLeaseTtlSeconds: integerEnv("EXECUTION_LEASE_TTL_SECONDS", 60, 30, 300),
    executionReconcileIntervalSeconds: integerEnv("EXECUTION_RECONCILE_INTERVAL_SECONDS", 60, 30, 900),
    executionE2bEnabled,
    executionDaytonaEnabled,
    executionGvisorEnabled,
    executionGvisorRuntime,
    executionCredentialBrokerEnabled,
    executionCredentialGrantTtlSeconds: integerEnv("EXECUTION_CREDENTIAL_GRANT_TTL_SECONDS", 300, 30, 900),
  };

  const bootstrapAdminToken = optional("BOOTSTRAP_ADMIN_TOKEN");
  if (bootstrapAdminToken) config.bootstrapAdminToken = bootstrapAdminToken;
  if (appUrl) config.appUrl = appUrl;
  if (publicAppUrl) config.publicAppUrl = publicAppUrl;
  if (metaAppId) config.metaAppId = metaAppId;
  if (metaAppSecret) config.metaAppSecret = metaAppSecret;
  if (metaGraphApiVersion) config.metaGraphApiVersion = metaGraphApiVersion;
  if (whatsappAccessToken) config.whatsappAccessToken = whatsappAccessToken;
  if (whatsappPhoneNumberId) config.whatsappPhoneNumberId = whatsappPhoneNumberId;
  if (whatsappBusinessAccountId) config.whatsappBusinessAccountId = whatsappBusinessAccountId;
  if (whatsappDisplayPhoneNumber) config.whatsappDisplayPhoneNumber = whatsappDisplayPhoneNumber;
  if (whatsappWebhookVerifyToken) config.whatsappWebhookVerifyToken = whatsappWebhookVerifyToken;
  if (whatsappConnectTokenSecret) config.whatsappConnectTokenSecret = whatsappConnectTokenSecret;
  if (browserRunnerUrl) config.browserRunnerUrl = browserRunnerUrl;
  if (browserRunnerSharedSecret) config.browserRunnerSharedSecret = browserRunnerSharedSecret;
  if (sandboxRunnerUrl) config.sandboxRunnerUrl = sandboxRunnerUrl;
  if (sandboxRunnerSharedSecret) config.sandboxRunnerSharedSecret = sandboxRunnerSharedSecret;
  if (googleOauthClientId) config.googleOauthClientId = googleOauthClientId;
  if (googleOauthClientSecret) config.googleOauthClientSecret = googleOauthClientSecret;
  if (googleOauthRedirectUri) config.googleOauthRedirectUri = googleOauthRedirectUri;
  if (e2bApiKey) config.e2bApiKey = e2bApiKey;
  if (daytonaApiKey) config.daytonaApiKey = daytonaApiKey;
  if (executionProxySharedSecret) config.executionProxySharedSecret = executionProxySharedSecret;

  cached = config;
  return config;
}

export function resetEnvForTests() {
  cached = null;
}
