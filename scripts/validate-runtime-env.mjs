function enabled(name) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function requireAll(feature, names) {
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`${feature} is enabled but required environment variables are missing: ${missing.join(", ")}`);
}

function integerBetween(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function validateOptionalRuntimeEnvironment() {
  const production = process.env.NODE_ENV === "production";

  if (enabled("TURNSTILE_ENABLED")) {
    requireAll("Turnstile", ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]);
    if (production) requireAll("Turnstile", ["TURNSTILE_EXPECTED_HOSTNAME"]);
  }

  if (production) {
    requireAll("Distributed rate limiting", ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]);
    requireAll("Private attachment signing", ["ATTACHMENT_SIGNING_SECRET"]);
    if (process.env.ATTACHMENT_SIGNING_SECRET.trim().length < 32) {
      throw new Error("ATTACHMENT_SIGNING_SECRET must contain at least 32 characters.");
    }
  }
  integerBetween("ATTACHMENT_URL_TTL_SECONDS", "60", 30, 300);

  const antivirusRequired = process.env.ANTIVIRUS_REQUIRED?.trim()
    ? enabled("ANTIVIRUS_REQUIRED")
    : production;
  if (antivirusRequired) {
    requireAll("Attachment antivirus", ["CLAMAV_HOST"]);
    integerBetween("CLAMAV_PORT", "3310", 1, 65535);
    integerBetween("CLAMAV_TIMEOUT_MS", "30000", 1000, 120000);
  }

  const bootstrapToken = process.env.BOOTSTRAP_ADMIN_TOKEN?.trim();
  if (bootstrapToken) {
    if (bootstrapToken.length < 32) throw new Error("BOOTSTRAP_ADMIN_TOKEN must contain at least 32 characters.");
    requireAll("Bootstrap token lifecycle", ["BOOTSTRAP_ADMIN_TOKEN_EXPIRES_AT"]);
    const expiresAt = new Date(process.env.BOOTSTRAP_ADMIN_TOKEN_EXPIRES_AT.trim());
    if (!Number.isFinite(expiresAt.getTime())) throw new Error("BOOTSTRAP_ADMIN_TOKEN_EXPIRES_AT must be an ISO-8601 timestamp.");
    if (production && expiresAt <= new Date()) throw new Error("BOOTSTRAP_ADMIN_TOKEN_EXPIRES_AT is already expired.");
  }

  const storage = process.env.OBJECT_STORAGE_DRIVER?.trim().toLowerCase() || "database";
  if (!new Set(["database", "local", "r2"]).has(storage)) throw new Error("OBJECT_STORAGE_DRIVER must be database, local or r2.");
  if (storage === "r2") {
    requireAll("R2", ["R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]);
    if (!process.env.R2_ACCOUNT_ID?.trim() && !process.env.R2_ENDPOINT?.trim()) throw new Error("R2 requires R2_ACCOUNT_ID or R2_ENDPOINT.");
    if (production && process.env.R2_PUBLIC_BASE_URL?.trim()) {
      throw new Error("R2_PUBLIC_BASE_URL must be empty because attachments are private.");
    }
  }

  if (enabled("CLOUDFLARE_AI_GATEWAY_ENABLED")) {
    requireAll("Cloudflare AI Gateway", [
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_AI_GATEWAY_ID",
    ]);
  }
  if (enabled("AI_PROVIDER_DIRECT_FALLBACK_ENABLED") && !enabled("AI_PROVIDER_FALLBACK_ENABLED")) {
    throw new Error("AI_PROVIDER_DIRECT_FALLBACK_ENABLED requires AI_PROVIDER_FALLBACK_ENABLED=true.");
  }
  if (enabled("WHATSAPP_INTEGRATION_ENABLED")) {
    requireAll("WhatsApp Business Platform", [
      "META_APP_ID",
      "META_APP_SECRET",
      "META_GRAPH_API_VERSION",
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_BUSINESS_ACCOUNT_ID",
      "WHATSAPP_DISPLAY_PHONE_NUMBER",
      "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
      "WHATSAPP_CONNECT_TOKEN_SECRET",
    ]);
    if (!process.env.PUBLIC_APP_URL?.trim() && !process.env.APP_URL?.trim()) {
      throw new Error("WhatsApp Business Platform requires PUBLIC_APP_URL or APP_URL.");
    }
    for (const name of ["META_APP_ID", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID"]) {
      if (!/^\d{5,30}$/.test(process.env[name].trim())) throw new Error(`${name} must contain digits only.`);
    }
    if (!/^v\d{1,3}\.\d{1,2}$/.test(process.env.META_GRAPH_API_VERSION.trim())) {
      throw new Error("META_GRAPH_API_VERSION must look like v23.0.");
    }
    if (!/^\d{8,20}$/.test(process.env.WHATSAPP_DISPLAY_PHONE_NUMBER.replace(/\D/g, ""))) {
      throw new Error("WHATSAPP_DISPLAY_PHONE_NUMBER is invalid.");
    }
    const publicUrl = process.env.PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
    if (!publicUrl) throw new Error("WhatsApp Business Platform requires PUBLIC_APP_URL or APP_URL.");
    const parsedUrl = new URL(publicUrl);
    if (production && parsedUrl.protocol !== "https:") {
      throw new Error("PUBLIC_APP_URL or APP_URL must use HTTPS in production.");
    }
    if (process.env.META_APP_SECRET.trim().length < 16) throw new Error("META_APP_SECRET is too short.");
    if (process.env.WHATSAPP_ACCESS_TOKEN.trim().length < 20) throw new Error("WHATSAPP_ACCESS_TOKEN is too short.");
    if (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN.trim().length < 16) {
      throw new Error("WHATSAPP_WEBHOOK_VERIFY_TOKEN must contain at least 16 characters.");
    }
    if (process.env.WHATSAPP_CONNECT_TOKEN_SECRET.trim().length < 32) {
      throw new Error("WHATSAPP_CONNECT_TOKEN_SECRET must contain at least 32 characters.");
    }
    integerBetween("WHATSAPP_CONNECT_TOKEN_TTL_MINUTES", "10", 5, 60);
  }
}
