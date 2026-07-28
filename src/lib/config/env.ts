type RuntimeEnvironment = {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  credentialEncryptionKey: string;
  bootstrapAdminToken?: string;
  appUrl?: string;
  logLevel: "debug" | "info" | "warn" | "error";
};

let cached: RuntimeEnvironment | null = null;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
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

  const nodeEnv = (process.env.NODE_ENV ?? "development") as RuntimeEnvironment["nodeEnv"];
  if (!new Set(["development", "test", "production"]).has(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test, or production.");
  }

  const appUrl = process.env.APP_URL?.trim();
  if (nodeEnv === "production" && appUrl && !appUrl.startsWith("https://")) {
    throw new Error("APP_URL must use HTTPS in production.");
  }

  cached = {
    nodeEnv,
    databaseUrl: required("DATABASE_URL"),
    credentialEncryptionKey: validateEncryptionKey(required("CREDENTIAL_ENCRYPTION_KEY")),
    bootstrapAdminToken: process.env.BOOTSTRAP_ADMIN_TOKEN?.trim() || undefined,
    appUrl,
    logLevel: (process.env.LOG_LEVEL ?? "info") as RuntimeEnvironment["logLevel"],
  };

  if (!new Set(["debug", "info", "warn", "error"]).has(cached.logLevel)) {
    throw new Error("LOG_LEVEL must be debug, info, warn, or error.");
  }

  return cached;
}

export function resetEnvForTests() {
  cached = null;
}
