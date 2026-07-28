type NodeEnvironment = "development" | "test" | "production";
type LogLevel = "debug" | "info" | "warn" | "error";

type RuntimeEnvironment = {
  nodeEnv: NodeEnvironment;
  databaseUrl: string;
  credentialEncryptionKey: string;
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

export function env(): RuntimeEnvironment {
  if (cached) return cached;

  const nodeEnv = parseNodeEnvironment(process.env.NODE_ENV);
  const appUrl = process.env.APP_URL?.trim();
  if (nodeEnv === "production" && appUrl && !appUrl.startsWith("https://")) {
    throw new Error("APP_URL must use HTTPS in production.");
  }

  const config: RuntimeEnvironment = {
    nodeEnv,
    databaseUrl: required("DATABASE_URL"),
    credentialEncryptionKey: validateEncryptionKey(required("CREDENTIAL_ENCRYPTION_KEY")),
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
