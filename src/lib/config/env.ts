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
};

let cached: RuntimeEnvironment | null = null;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
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

export function env(): RuntimeEnvironment {
  if (cached) return cached;

  const nodeEnv = parseNodeEnvironment(process.env.NODE_ENV);
  const appUrl = process.env.APP_URL?.trim();
  if (nodeEnv === "production" && !appUrl) {
    throw new Error("APP_URL is required in production.");
  }
  if (nodeEnv === "production" && appUrl && !appUrl.startsWith("https://")) {
    throw new Error("APP_URL must use HTTPS in production.");
  }

  const config: RuntimeEnvironment = {
    nodeEnv,
    databaseUrl: required("DATABASE_URL"),
    credentialEncryptionKey: validateEncryptionKey(required("CREDENTIAL_ENCRYPTION_KEY")),
    credentialEncryptionKeyId: encryptionKeyId(process.env.CREDENTIAL_ENCRYPTION_KEY_ID),
    credentialEncryptionPreviousKeys: previousEncryptionKeys(process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS),
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
  };

  const bootstrapAdminToken = process.env.BOOTSTRAP_ADMIN_TOKEN?.trim();
  if (bootstrapAdminToken) config.bootstrapAdminToken = bootstrapAdminToken;
  if (appUrl) config.appUrl = appUrl;

  cached = config;
  return config;
}

export function resetEnvForTests() {
  cached = null;
}
