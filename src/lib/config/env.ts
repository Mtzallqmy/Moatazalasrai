type RuntimeEnvironment = {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  credentialEncryptionKey: string;
  bootstrapAdminToken?: string;
  appUrl?: string;
  logLevel: "debug" | "info" | "warn" | "error";
};

const NODE_ENVIRONMENTS = new Set<RuntimeEnvironment["nodeEnv"]>([
  "development",
  "test",
  "production",
]);
const LOG_LEVELS = new Set<RuntimeEnvironment["logLevel"]>([
  "debug",
  "info",
  "warn",
  "error",
]);

let cached: RuntimeEnvironment | null = null;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseNodeEnvironment(value: string): RuntimeEnvironment["nodeEnv"] {
  if (!NODE_ENVIRONMENTS.has(value as RuntimeEnvironment["nodeEnv"])) {
    throw new Error("NODE_ENV must be development, test, or production.");
  }
  return value as RuntimeEnvironment["nodeEnv"];
}

function parseLogLevel(value: string): RuntimeEnvironment["logLevel"] {
  if (!LOG_LEVELS.has(value as RuntimeEnvironment["logLevel"])) {
    throw new Error("LOG_LEVEL must be debug, info, warn, or error.");
  }
  return value as RuntimeEnvironment["logLevel"];
}

function validateEncryptionKey(value: string): string {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte value.");
  }
  return value;
}

export function env(): RuntimeEnvironment {
  if (cached) return cached;

  const nodeEnv = parseNodeEnvironment(process.env.NODE_ENV ?? "development");
  const appUrl = process.env.APP_URL?.trim();
  if (nodeEnv === "production" && appUrl && !appUrl.startsWith("https://")) {
    throw new Error("APP_URL must use HTTPS in production.");
  }

  const bootstrapAdminToken = process.env.BOOTSTRAP_ADMIN_TOKEN?.trim();
  const config: RuntimeEnvironment = {
    nodeEnv,
    databaseUrl: required("DATABASE_URL"),
    credentialEncryptionKey: validateEncryptionKey(required("CREDENTIAL_ENCRYPTION_KEY")),
    logLevel: parseLogLevel(process.env.LOG_LEVEL ?? "info"),
  };

  if (bootstrapAdminToken) config.bootstrapAdminToken = bootstrapAdminToken;
  if (appUrl) config.appUrl = appUrl;

  cached = config;
  return cached;
}

export function resetEnvForTests() {
  cached = null;
}
