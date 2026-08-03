function enabled(name) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function requireAll(feature, names) {
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`${feature} is enabled but required environment variables are missing: ${missing.join(", ")}`);
}

export function validateOptionalRuntimeEnvironment() {
  if (enabled("TURNSTILE_ENABLED")) {
    requireAll("Turnstile", ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]);
    if (process.env.NODE_ENV === "production") requireAll("Turnstile", ["TURNSTILE_EXPECTED_HOSTNAME"]);
  }
  const storage = process.env.OBJECT_STORAGE_DRIVER?.trim().toLowerCase() || "database";
  if (!new Set(["database", "local", "r2"]).has(storage)) throw new Error("OBJECT_STORAGE_DRIVER must be database, local or r2.");
  if (storage === "r2") {
    requireAll("R2", ["R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]);
    if (!process.env.R2_ACCOUNT_ID?.trim() && !process.env.R2_ENDPOINT?.trim()) throw new Error("R2 requires R2_ACCOUNT_ID or R2_ENDPOINT.");
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
}
