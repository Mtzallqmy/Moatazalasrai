function enabled(name) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function requireAll(feature, names) {
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`${feature} is enabled but required environment variables are missing: ${missing.join(", ")}`);
}

function publicAppUrl(feature) {
  const value = process.env.PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (!value) throw new Error(`${feature} requires PUBLIC_APP_URL or APP_URL.`);
  const parsed = new URL(value);
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("PUBLIC_APP_URL or APP_URL must use HTTPS in production.");
  }
  return value;
}

function integer(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function validateExecutionKernel() {
  if (!enabled("EXECUTION_KERNEL_ENABLED")) return;
  const runner = process.env.EXECUTION_RUNNER?.trim() || "existing";
  if (!new Set(["existing", "gvisor", "e2b", "daytona"]).has(runner)) {
    throw new Error("EXECUTION_RUNNER must be existing, gvisor, e2b or daytona.");
  }
  const network = process.env.EXECUTION_DEFAULT_NETWORK_MODE?.trim() || "deny_all";
  if (!new Set(["deny_all", "allowlist"]).has(network)) {
    throw new Error("EXECUTION_DEFAULT_NETWORK_MODE must be deny_all or allowlist.");
  }
  integer("EXECUTION_DEFAULT_TIMEOUT_MS", 300000, 1000, 1800000);
  integer("EXECUTION_DEFAULT_MEMORY_BYTES", 536870912, 67108864, 8589934592);
  integer("EXECUTION_DEFAULT_DISK_BYTES", 1073741824, 16777216, 21474836480);
  integer("EXECUTION_DEFAULT_MAX_PROCESSES", 64, 1, 512);
  integer("EXECUTION_DEFAULT_MAX_OUTPUT_BYTES", 5242880, 1024, 52428800);
  integer("EXECUTION_DEFAULT_MAX_ARTIFACT_BYTES", 104857600, 1024, 2147483648);
  integer("EXECUTION_WORKSPACE_TTL_SECONDS", 1800, 60, 86400);
  integer("EXECUTION_HEARTBEAT_INTERVAL_SECONDS", 15, 5, 300);
  integer("EXECUTION_LEASE_TTL_SECONDS", 60, 30, 300);
  integer("EXECUTION_RECONCILE_INTERVAL_SECONDS", 60, 30, 900);
  integer("EXECUTION_CREDENTIAL_GRANT_TTL_SECONDS", 300, 30, 900);

  if (runner === "existing") {
    requireAll("Execution Kernel existing runner", ["SANDBOX_RUNNER_URL", "SANDBOX_RUNNER_SHARED_SECRET"]);
  }
  if (runner === "e2b") {
    if (!enabled("EXECUTION_E2B_ENABLED")) throw new Error("EXECUTION_RUNNER=e2b requires EXECUTION_E2B_ENABLED=true.");
    requireAll("E2B execution adapter", ["E2B_API_KEY"]);
  }
  if (runner === "daytona") {
    if (!enabled("EXECUTION_DAYTONA_ENABLED")) throw new Error("EXECUTION_RUNNER=daytona requires EXECUTION_DAYTONA_ENABLED=true.");
    requireAll("Daytona execution adapter", ["DAYTONA_API_KEY"]);
  }
  if (runner === "gvisor") {
    if (!enabled("EXECUTION_GVISOR_ENABLED")) throw new Error("EXECUTION_RUNNER=gvisor requires EXECUTION_GVISOR_ENABLED=true.");
    if (process.env.RAILWAY_ENVIRONMENT?.trim()) throw new Error("gVisor/runsc requires a dedicated host and is not supported inside Railway.");
    requireAll("gVisor execution adapter", ["EXECUTION_GVISOR_RUNTIME"]);
  }
  if (enabled("EXECUTION_CREDENTIAL_BROKER_ENABLED") || process.env.EXECUTION_CREDENTIAL_BROKER_ENABLED === undefined) {
    requireAll("Execution Credential Broker", ["EXECUTION_PROXY_SHARED_SECRET"]);
    if (process.env.EXECUTION_PROXY_SHARED_SECRET.trim().length < 32) {
      throw new Error("EXECUTION_PROXY_SHARED_SECRET must contain at least 32 characters.");
    }
  }
  if (process.env.SANDBOX_RUNNER_SHARED_SECRET && process.env.SANDBOX_RUNNER_SHARED_SECRET.trim().length < 32) {
    throw new Error("SANDBOX_RUNNER_SHARED_SECRET must contain at least 32 characters.");
  }
}

export function validateOptionalRuntimeEnvironment() {
  const supabaseValues = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"];
  if (supabaseValues.some((name) => process.env[name]?.trim())) {
    requireAll("Supabase Auth", supabaseValues);
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a Supabase HTTPS project URL.");
  }
  if (enabled("TURNSTILE_ENABLED")) {
    requireAll("Turnstile", ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]);
    if (process.env.NODE_ENV === "production") requireAll("Turnstile", ["TURNSTILE_EXPECTED_HOSTNAME"]);
  }

  const storage = process.env.OBJECT_STORAGE_DRIVER?.trim().toLowerCase() || "database";
  if (!new Set(["database", "local", "r2"]).has(storage)) throw new Error("OBJECT_STORAGE_DRIVER must be database, local or r2.");
  if (process.env.NODE_ENV === "production" && storage !== "r2") {
    throw new Error("Production chat attachments require OBJECT_STORAGE_DRIVER=r2 so direct uploads do not fall back through the application server.");
  }
  if (storage === "r2") {
    requireAll("R2", ["R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]);
    if (!process.env.R2_ACCOUNT_ID?.trim() && !process.env.R2_ENDPOINT?.trim()) throw new Error("R2 requires R2_ACCOUNT_ID or R2_ENDPOINT.");
  }



  validateExecutionKernel();



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
    publicAppUrl("WhatsApp Business Platform");
    for (const name of ["META_APP_ID", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID"]) {
      if (!/^\d{5,30}$/.test(process.env[name].trim())) throw new Error(`${name} must contain digits only.`);
    }
    if (!/^v\d{1,3}\.\d{1,2}$/.test(process.env.META_GRAPH_API_VERSION.trim())) {
      throw new Error("META_GRAPH_API_VERSION must look like v23.0.");
    }
    if (!/^\d{8,20}$/.test(process.env.WHATSAPP_DISPLAY_PHONE_NUMBER.replace(/\D/g, ""))) {
      throw new Error("WHATSAPP_DISPLAY_PHONE_NUMBER is invalid.");
    }
    if (process.env.META_APP_SECRET.trim().length < 16) throw new Error("META_APP_SECRET is too short.");
    if (process.env.WHATSAPP_ACCESS_TOKEN.trim().length < 20) throw new Error("WHATSAPP_ACCESS_TOKEN is too short.");
    if (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN.trim().length < 16) {
      throw new Error("WHATSAPP_WEBHOOK_VERIFY_TOKEN must contain at least 16 characters.");
    }
    if (process.env.WHATSAPP_CONNECT_TOKEN_SECRET.trim().length < 32) {
      throw new Error("WHATSAPP_CONNECT_TOKEN_SECRET must contain at least 32 characters.");
    }
    const ttl = Number(process.env.WHATSAPP_CONNECT_TOKEN_TTL_MINUTES ?? "10");
    if (!Number.isSafeInteger(ttl) || ttl < 5 || ttl > 60) {
      throw new Error("WHATSAPP_CONNECT_TOKEN_TTL_MINUTES must be an integer between 5 and 60.");
    }
  }
}
