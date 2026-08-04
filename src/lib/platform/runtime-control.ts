import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { workerHeartbeats } from "@/db/agent-runtime-schema";
import { platformRuntimeSettings } from "@/db/platform-runtime-schema";
import { env, resetEnvForTests } from "@/lib/config/env";
import { ApiError } from "@/lib/http/api";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/security/encryption";

const SETTINGS_ID = "primary";
const CACHE_TTL_MS = 5_000;
const WHATSAPP_CONTEXT = "platform-runtime:whatsapp";
const SANDBOX_CONTEXT = "platform-runtime:sandbox";
const BROWSER_CONTEXT = "platform-runtime:browser";

const optionalSecret = z.string().trim().max(8_000).optional();
const serviceUrlSchema = z.string().trim().url().max(2_000);

const whatsappConfigInputSchema = z.object({
  appId: z.string().trim().regex(/^\d{5,30}$/).optional(),
  appSecret: optionalSecret,
  graphApiVersion: z.string().trim().regex(/^v\d{1,3}\.\d{1,2}$/).optional(),
  accessToken: optionalSecret,
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/).optional(),
  businessAccountId: z.string().trim().regex(/^\d{5,30}$/).optional(),
  displayPhoneNumber: z.string().trim().max(30).optional(),
  webhookVerifyToken: optionalSecret,
  connectTokenSecret: optionalSecret,
  publicAppUrl: serviceUrlSchema.optional(),
}).strict();

export const runtimeControlUpdateSchema = z.discriminatedUnion("feature", [
  z.object({
    feature: z.literal("whatsapp"),
    enabled: z.boolean(),
    connectTtlMinutes: z.number().int().min(5).max(60).default(10),
    config: whatsappConfigInputSchema.default({}),
  }).strict(),
  z.object({
    feature: z.literal("sandbox"),
    enabled: z.boolean(),
    runnerUrl: serviceUrlSchema.optional(),
    sharedSecret: optionalSecret,
    executionTimeoutMs: z.number().int().min(1_000).max(1_800_000).default(300_000),
    maxOutputBytes: z.number().int().min(1_024).max(20_971_520).default(2_097_152),
    maxFileBytes: z.number().int().min(1_024).max(104_857_600).default(10_485_760),
    workspaceDiskBytes: z.number().int().min(10_485_760).max(10_737_418_240).default(536_870_912),
    maxConcurrentPerOrganization: z.number().int().min(1).max(20).default(2),
  }).strict(),
  z.object({
    feature: z.literal("browser"),
    enabled: z.boolean(),
    runnerUrl: serviceUrlSchema.optional(),
    sharedSecret: optionalSecret,
    interactiveLoginEnabled: z.boolean().default(false),
    screenshotsEnabled: z.boolean().default(true),
    taskTimeoutMs: z.number().int().min(10_000).max(1_800_000).default(300_000),
    maxSteps: z.number().int().min(1).max(100).default(50),
    maxPages: z.number().int().min(1).max(10).default(5),
    allowedDownloadBytes: z.number().int().min(1_024).max(104_857_600).default(10_485_760),
  }).strict(),
]);

export type RuntimeControlUpdate = z.infer<typeof runtimeControlUpdateSchema>;

type WhatsAppConfig = {
  appId: string;
  appSecret: string;
  graphApiVersion: string;
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber: string;
  webhookVerifyToken: string;
  connectTokenSecret: string;
  publicAppUrl: string;
};

type RuntimeRow = typeof platformRuntimeSettings.$inferSelect;
type HealthResult = {
  status: "healthy" | "disabled" | "unconfigured" | "unreachable";
  checkedAt: string;
  latencyMs: number;
  details: string;
};

let rowCache: { value: RuntimeRow | null; expiresAt: number } | null = null;
let hydrationPromise: Promise<RuntimeControlSnapshot> | null = null;

function setEnvironment(name: string, value: string | number | boolean | null | undefined) {
  if (value === undefined || value === null || value === "") delete process.env[name];
  else process.env[name] = String(value);
}

function normalizeServiceUrl(value: string, name: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError(422, "INVALID_RUNTIME_URL", `${name} غير صالح.`); }
  if (url.username || url.password || url.hash || url.search) {
    throw new ApiError(422, "INVALID_RUNTIME_URL", `${name} يجب ألا يحتوي بيانات دخول أو query أو fragment.`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new ApiError(422, "INVALID_RUNTIME_URL", `${name} يجب أن يستخدم HTTP أو HTTPS.`);
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !local) {
    throw new ApiError(422, "INSECURE_RUNTIME_URL", `${name} يجب أن يستخدم HTTPS في الإنتاج.`);
  }
  return url.toString().replace(/\/$/, "");
}

function masked(value: string | undefined) {
  return value ? maskSecret(value) : null;
}

function decryptJson<T>(value: string | null, context: string): T | null {
  if (!value) return null;
  return JSON.parse(decryptSecret(value, context)) as T;
}

async function readRuntimeRow(force = false) {
  if (!force && rowCache && rowCache.expiresAt > Date.now()) return rowCache.value;
  const [row] = await db().select().from(platformRuntimeSettings)
    .where(eq(platformRuntimeSettings.id, SETTINGS_ID)).limit(1);
  rowCache = { value: row ?? null, expiresAt: Date.now() + CACHE_TTL_MS };
  return row ?? null;
}

function whatsappFromEnvironment(): WhatsAppConfig | null {
  const candidate = {
    appId: process.env.META_APP_ID?.trim(),
    appSecret: process.env.META_APP_SECRET?.trim(),
    graphApiVersion: process.env.META_GRAPH_API_VERSION?.trim(),
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN?.trim(),
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim(),
    displayPhoneNumber: process.env.WHATSAPP_DISPLAY_PHONE_NUMBER?.trim(),
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim(),
    connectTokenSecret: process.env.WHATSAPP_CONNECT_TOKEN_SECRET?.trim(),
    publicAppUrl: process.env.PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim(),
  };
  return Object.values(candidate).every(Boolean) ? candidate as WhatsAppConfig : null;
}

function completeWhatsApp(input: Partial<WhatsAppConfig>, existing: WhatsAppConfig | null): WhatsAppConfig | null {
  const merged = {
    appId: input.appId || existing?.appId,
    appSecret: input.appSecret || existing?.appSecret,
    graphApiVersion: input.graphApiVersion || existing?.graphApiVersion || "v23.0",
    accessToken: input.accessToken || existing?.accessToken,
    phoneNumberId: input.phoneNumberId || existing?.phoneNumberId,
    businessAccountId: input.businessAccountId || existing?.businessAccountId,
    displayPhoneNumber: input.displayPhoneNumber?.replace(/\D/g, "") || existing?.displayPhoneNumber,
    webhookVerifyToken: input.webhookVerifyToken || existing?.webhookVerifyToken,
    connectTokenSecret: input.connectTokenSecret || existing?.connectTokenSecret,
    publicAppUrl: input.publicAppUrl || existing?.publicAppUrl,
  };
  if (!Object.values(merged).every(Boolean)) return null;
  if (merged.appSecret!.length < 16 || merged.accessToken!.length < 20 || merged.webhookVerifyToken!.length < 16 || merged.connectTokenSecret!.length < 32) {
    throw new ApiError(422, "WHATSAPP_SECRET_TOO_SHORT", "أحد أسرار WhatsApp أقصر من الحد الأمني المطلوب.");
  }
  return merged as WhatsAppConfig;
}

function applyManagedRow(row: RuntimeRow | null) {
  if (!row) return;
  if (row.whatsappManaged) {
    const config = decryptJson<WhatsAppConfig>(row.whatsappConfigEncrypted, WHATSAPP_CONTEXT);
    const enabled = row.whatsappEnabled && Boolean(config);
    setEnvironment("WHATSAPP_INTEGRATION_ENABLED", enabled);
    setEnvironment("WHATSAPP_CONNECT_TOKEN_TTL_MINUTES", row.whatsappConnectTtlMinutes);
    setEnvironment("META_APP_ID", enabled ? config?.appId : null);
    setEnvironment("META_APP_SECRET", enabled ? config?.appSecret : null);
    setEnvironment("META_GRAPH_API_VERSION", enabled ? config?.graphApiVersion : null);
    setEnvironment("WHATSAPP_ACCESS_TOKEN", enabled ? config?.accessToken : null);
    setEnvironment("WHATSAPP_PHONE_NUMBER_ID", enabled ? config?.phoneNumberId : null);
    setEnvironment("WHATSAPP_BUSINESS_ACCOUNT_ID", enabled ? config?.businessAccountId : null);
    setEnvironment("WHATSAPP_DISPLAY_PHONE_NUMBER", enabled ? config?.displayPhoneNumber : null);
    setEnvironment("WHATSAPP_WEBHOOK_VERIFY_TOKEN", enabled ? config?.webhookVerifyToken : null);
    setEnvironment("WHATSAPP_CONNECT_TOKEN_SECRET", enabled ? config?.connectTokenSecret : null);
    setEnvironment("PUBLIC_APP_URL", enabled ? config?.publicAppUrl : null);
  }
  if (row.sandboxManaged) {
    const secret = row.sandboxRunnerSecretEncrypted
      ? decryptSecret(row.sandboxRunnerSecretEncrypted, SANDBOX_CONTEXT)
      : null;
    const enabled = row.sandboxEnabled && Boolean(row.sandboxRunnerUrl && secret);
    setEnvironment("SANDBOX_ENABLED", enabled);
    setEnvironment("SANDBOX_RUNNER_URL", enabled ? row.sandboxRunnerUrl : null);
    setEnvironment("SANDBOX_RUNNER_SHARED_SECRET", enabled ? secret : null);
    setEnvironment("SANDBOX_EXECUTION_TIMEOUT_MS", row.sandboxExecutionTimeoutMs);
    setEnvironment("SANDBOX_MAX_OUTPUT_BYTES", row.sandboxMaxOutputBytes);
    setEnvironment("SANDBOX_MAX_FILE_BYTES", row.sandboxMaxFileBytes);
    setEnvironment("SANDBOX_WORKSPACE_DISK_BYTES", row.sandboxWorkspaceDiskBytes);
    setEnvironment("SANDBOX_MAX_CONCURRENT_PER_ORG", row.sandboxMaxConcurrentPerOrg);
  }
  if (row.browserManaged) {
    const secret = row.browserRunnerSecretEncrypted
      ? decryptSecret(row.browserRunnerSecretEncrypted, BROWSER_CONTEXT)
      : null;
    const enabled = row.browserEnabled && Boolean(row.browserRunnerUrl && secret);
    setEnvironment("BROWSER_AGENT_ENABLED", enabled);
    setEnvironment("BROWSER_RUNNER_URL", enabled ? row.browserRunnerUrl : null);
    setEnvironment("BROWSER_RUNNER_SHARED_SECRET", enabled ? secret : null);
    setEnvironment("BROWSER_INTERACTIVE_LOGIN_ENABLED", enabled && row.browserInteractiveLoginEnabled);
    setEnvironment("BROWSER_SCREENSHOTS_ENABLED", enabled && row.browserScreenshotsEnabled);
    setEnvironment("BROWSER_TASK_TIMEOUT_MS", row.browserTaskTimeoutMs);
    setEnvironment("BROWSER_MAX_STEPS", row.browserMaxSteps);
    setEnvironment("BROWSER_MAX_PAGES", row.browserMaxPages);
    setEnvironment("BROWSER_ALLOWED_DOWNLOAD_BYTES", row.browserAllowedDownloadBytes);
  }
}

export type RuntimeControlSnapshot = {
  checkedAt: string;
  whatsapp: {
    managed: boolean;
    source: "database" | "environment";
    enabled: boolean;
    configured: boolean;
    displayPhoneNumber: string | null;
    appId: string | null;
    phoneNumberId: string | null;
    businessAccountId: string | null;
    graphApiVersion: string;
    publicAppUrl: string | null;
    appSecretHint: string | null;
    accessTokenHint: string | null;
    webhookVerifyTokenHint: string | null;
    connectTokenSecretHint: string | null;
    connectTtlMinutes: number;
  };
  sandbox: {
    managed: boolean;
    source: "database" | "environment";
    enabled: boolean;
    configured: boolean;
    runnerUrl: string | null;
    sharedSecretHint: string | null;
    executionTimeoutMs: number;
    maxOutputBytes: number;
    maxFileBytes: number;
    workspaceDiskBytes: number;
    maxConcurrentPerOrganization: number;
  };
  browser: {
    managed: boolean;
    source: "database" | "environment";
    enabled: boolean;
    configured: boolean;
    runnerUrl: string | null;
    sharedSecretHint: string | null;
    interactiveLoginEnabled: boolean;
    screenshotsEnabled: boolean;
    taskTimeoutMs: number;
    maxSteps: number;
    maxPages: number;
    allowedDownloadBytes: number;
  };
  worker: { active: boolean; lastSeenAt: string | null; workerId: string | null };
  lastHealth: Record<string, unknown>;
};

async function buildSnapshot(row: RuntimeRow | null): Promise<RuntimeControlSnapshot> {
  const config = env();
  const whatsapp = whatsappFromEnvironment();
  const [heartbeat] = await db().select({
    workerId: workerHeartbeats.workerId,
    lastSeenAt: workerHeartbeats.lastSeenAt,
  }).from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastSeenAt)).limit(1);
  const workerActive = Boolean(heartbeat?.lastSeenAt && Date.now() - heartbeat.lastSeenAt.getTime() <= 90_000);
  return {
    checkedAt: new Date().toISOString(),
    whatsapp: {
      managed: row?.whatsappManaged ?? false,
      source: row?.whatsappManaged ? "database" : "environment",
      enabled: config.whatsappIntegrationEnabled,
      configured: Boolean(whatsapp),
      displayPhoneNumber: whatsapp?.displayPhoneNumber ?? null,
      appId: whatsapp?.appId ?? null,
      phoneNumberId: whatsapp?.phoneNumberId ?? null,
      businessAccountId: whatsapp?.businessAccountId ?? null,
      graphApiVersion: whatsapp?.graphApiVersion ?? "v23.0",
      publicAppUrl: whatsapp?.publicAppUrl ?? null,
      appSecretHint: masked(whatsapp?.appSecret),
      accessTokenHint: masked(whatsapp?.accessToken),
      webhookVerifyTokenHint: masked(whatsapp?.webhookVerifyToken),
      connectTokenSecretHint: masked(whatsapp?.connectTokenSecret),
      connectTtlMinutes: config.whatsappConnectTokenTtlMinutes,
    },
    sandbox: {
      managed: row?.sandboxManaged ?? false,
      source: row?.sandboxManaged ? "database" : "environment",
      enabled: config.sandboxEnabled,
      configured: Boolean(config.sandboxRunnerUrl && config.sandboxRunnerSharedSecret),
      runnerUrl: config.sandboxRunnerUrl ?? null,
      sharedSecretHint: masked(config.sandboxRunnerSharedSecret),
      executionTimeoutMs: config.sandboxExecutionTimeoutMs,
      maxOutputBytes: config.sandboxMaxOutputBytes,
      maxFileBytes: config.sandboxMaxFileBytes,
      workspaceDiskBytes: config.sandboxWorkspaceDiskBytes,
      maxConcurrentPerOrganization: config.sandboxMaxConcurrentPerOrganization,
    },
    browser: {
      managed: row?.browserManaged ?? false,
      source: row?.browserManaged ? "database" : "environment",
      enabled: config.browserAgentEnabled,
      configured: Boolean(config.browserRunnerUrl && config.browserRunnerSharedSecret),
      runnerUrl: config.browserRunnerUrl ?? null,
      sharedSecretHint: masked(config.browserRunnerSharedSecret),
      interactiveLoginEnabled: config.browserInteractiveLoginEnabled,
      screenshotsEnabled: config.browserScreenshotsEnabled,
      taskTimeoutMs: config.browserTaskTimeoutMs,
      maxSteps: config.browserMaxSteps,
      maxPages: config.browserMaxPages,
      allowedDownloadBytes: config.browserAllowedDownloadBytes,
    },
    worker: {
      active: workerActive,
      lastSeenAt: heartbeat?.lastSeenAt?.toISOString() ?? null,
      workerId: heartbeat?.workerId ?? null,
    },
    lastHealth: row?.lastHealth ?? {},
  };
}

export async function hydrateRuntimeControlPlane(force = false): Promise<RuntimeControlSnapshot> {
  if (!force && hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    const row = await readRuntimeRow(force);
    applyManagedRow(row);
    resetEnvForTests();
    return buildSnapshot(row);
  })();
  try { return await hydrationPromise; }
  finally { hydrationPromise = null; }
}

export function invalidateRuntimeControlPlane() {
  rowCache = null;
  hydrationPromise = null;
  resetEnvForTests();
}

async function timedFetch(url: string, init?: RequestInit, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal, cache: "no-store", redirect: "error" }); }
  finally { clearTimeout(timeout); }
}

async function testWhatsApp(config: WhatsAppConfig): Promise<HealthResult> {
  const started = performance.now();
  const url = new URL(`/${config.graphApiVersion}/${config.phoneNumberId}`, "https://graph.facebook.com");
  url.searchParams.set("fields", "display_phone_number,verified_name,quality_rating");
  try {
    const response = await timedFetch(url.toString(), {
      headers: { authorization: `Bearer ${config.accessToken}`, accept: "application/json" },
    });
    const payload = await response.json().catch(() => null) as { display_phone_number?: string; verified_name?: string; error?: { message?: string } } | null;
    if (!response.ok) throw new Error(payload?.error?.message || `Meta Graph API HTTP ${response.status}`);
    return {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started),
      details: `${payload?.verified_name ?? "WhatsApp Business"} — ${payload?.display_phone_number ?? config.displayPhoneNumber}`,
    };
  } catch (error) {
    return {
      status: "unreachable",
      checkedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started),
      details: error instanceof Error ? error.message : "تعذر الاتصال بـ Meta Graph API.",
    };
  }
}

async function testRunner(url: string, label: string): Promise<HealthResult> {
  const started = performance.now();
  try {
    const response = await timedFetch(new URL("/health", `${url}/`).toString(), { headers: { accept: "application/json" } });
    const text = await response.text();
    if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
    return {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started),
      details: text.slice(0, 240) || `${label} متاح`,
    };
  } catch (error) {
    return {
      status: "unreachable",
      checkedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started),
      details: error instanceof Error ? error.message : `تعذر الاتصال بخدمة ${label}.`,
    };
  }
}

async function existingWhatsApp(row: RuntimeRow | null) {
  return decryptJson<WhatsAppConfig>(row?.whatsappConfigEncrypted ?? null, WHATSAPP_CONTEXT) ?? whatsappFromEnvironment();
}

async function existingRunnerSecret(row: RuntimeRow | null, feature: "sandbox" | "browser") {
  const encrypted = feature === "sandbox" ? row?.sandboxRunnerSecretEncrypted : row?.browserRunnerSecretEncrypted;
  if (encrypted) return decryptSecret(encrypted, feature === "sandbox" ? SANDBOX_CONTEXT : BROWSER_CONTEXT);
  return feature === "sandbox" ? process.env.SANDBOX_RUNNER_SHARED_SECRET?.trim() : process.env.BROWSER_RUNNER_SHARED_SECRET?.trim();
}

export async function saveRuntimeControl(input: RuntimeControlUpdate, actorUserId: string) {
  const row = await readRuntimeRow(true);
  let set: Partial<typeof platformRuntimeSettings.$inferInsert> = {
    id: SETTINGS_ID,
    updatedByUserId: actorUserId,
    updatedAt: new Date(),
  };
  let health: HealthResult;

  if (input.feature === "whatsapp") {
    const existing = await existingWhatsApp(row);
    const candidate = completeWhatsApp(input.config, existing);
    if (input.enabled && !candidate) {
      throw new ApiError(422, "WHATSAPP_CONFIG_INCOMPLETE", "أكمل جميع بيانات Meta وWhatsApp قبل التفعيل.");
    }
    health = input.enabled && candidate ? await testWhatsApp(candidate) : {
      status: input.enabled ? "unconfigured" : "disabled", checkedAt: new Date().toISOString(), latencyMs: 0,
      details: input.enabled ? "إعدادات WhatsApp غير مكتملة." : "WhatsApp متوقف إداريًا.",
    };
    if (input.enabled && health.status !== "healthy") {
      throw new ApiError(422, "WHATSAPP_HEALTH_CHECK_FAILED", `فشل اختبار WhatsApp: ${health.details}`);
    }
    set = {
      ...set,
      whatsappManaged: true,
      whatsappEnabled: input.enabled,
      whatsappConnectTtlMinutes: input.connectTtlMinutes,
      whatsappConfigEncrypted: candidate ? encryptSecret(JSON.stringify(candidate), WHATSAPP_CONTEXT) : row?.whatsappConfigEncrypted ?? null,
      lastHealth: { ...(row?.lastHealth ?? {}), whatsapp: health },
    };
  } else if (input.feature === "sandbox") {
    const runnerUrl = input.runnerUrl ? normalizeServiceUrl(input.runnerUrl, "رابط Sandbox Runner") : row?.sandboxRunnerUrl ?? process.env.SANDBOX_RUNNER_URL?.trim();
    const secret = input.sharedSecret || await existingRunnerSecret(row, "sandbox");
    if (input.enabled && (!runnerUrl || !secret || secret.length < 32)) {
      throw new ApiError(422, "SANDBOX_CONFIG_INCOMPLETE", "أدخل رابط Sandbox Runner وسرًا مشتركًا بطول 32 حرفًا على الأقل.");
    }
    health = input.enabled && runnerUrl ? await testRunner(runnerUrl, "Sandbox Runner") : {
      status: input.enabled ? "unconfigured" : "disabled", checkedAt: new Date().toISOString(), latencyMs: 0,
      details: input.enabled ? "إعدادات Sandbox غير مكتملة." : "Sandbox متوقف إداريًا.",
    };
    if (input.enabled && health.status !== "healthy") {
      throw new ApiError(422, "SANDBOX_HEALTH_CHECK_FAILED", `فشل اختبار Sandbox: ${health.details}`);
    }
    set = {
      ...set,
      sandboxManaged: true,
      sandboxEnabled: input.enabled,
      sandboxRunnerUrl: runnerUrl ?? null,
      sandboxRunnerSecretEncrypted: secret ? encryptSecret(secret, SANDBOX_CONTEXT) : row?.sandboxRunnerSecretEncrypted ?? null,
      sandboxExecutionTimeoutMs: input.executionTimeoutMs,
      sandboxMaxOutputBytes: input.maxOutputBytes,
      sandboxMaxFileBytes: input.maxFileBytes,
      sandboxWorkspaceDiskBytes: input.workspaceDiskBytes,
      sandboxMaxConcurrentPerOrg: input.maxConcurrentPerOrganization,
      lastHealth: { ...(row?.lastHealth ?? {}), sandbox: health },
    };
  } else {
    const runnerUrl = input.runnerUrl ? normalizeServiceUrl(input.runnerUrl, "رابط Browser Runner") : row?.browserRunnerUrl ?? process.env.BROWSER_RUNNER_URL?.trim();
    const secret = input.sharedSecret || await existingRunnerSecret(row, "browser");
    if (input.enabled && (!runnerUrl || !secret || secret.length < 32)) {
      throw new ApiError(422, "BROWSER_CONFIG_INCOMPLETE", "أدخل رابط Browser Runner وسرًا مشتركًا بطول 32 حرفًا على الأقل.");
    }
    health = input.enabled && runnerUrl ? await testRunner(runnerUrl, "Browser Runner") : {
      status: input.enabled ? "unconfigured" : "disabled", checkedAt: new Date().toISOString(), latencyMs: 0,
      details: input.enabled ? "إعدادات Browser Runner غير مكتملة." : "Browser Agent متوقف إداريًا.",
    };
    if (input.enabled && health.status !== "healthy") {
      throw new ApiError(422, "BROWSER_HEALTH_CHECK_FAILED", `فشل اختبار Browser Runner: ${health.details}`);
    }
    set = {
      ...set,
      browserManaged: true,
      browserEnabled: input.enabled,
      browserRunnerUrl: runnerUrl ?? null,
      browserRunnerSecretEncrypted: secret ? encryptSecret(secret, BROWSER_CONTEXT) : row?.browserRunnerSecretEncrypted ?? null,
      browserInteractiveLoginEnabled: input.interactiveLoginEnabled,
      browserScreenshotsEnabled: input.screenshotsEnabled,
      browserTaskTimeoutMs: input.taskTimeoutMs,
      browserMaxSteps: input.maxSteps,
      browserMaxPages: input.maxPages,
      browserAllowedDownloadBytes: input.allowedDownloadBytes,
      lastHealth: { ...(row?.lastHealth ?? {}), browser: health },
    };
  }

  await db().insert(platformRuntimeSettings).values(set as typeof platformRuntimeSettings.$inferInsert)
    .onConflictDoUpdate({ target: platformRuntimeSettings.id, set });
  invalidateRuntimeControlPlane();
  return hydrateRuntimeControlPlane(true);
}

export async function testCurrentRuntimeFeature(feature: "whatsapp" | "sandbox" | "browser") {
  await hydrateRuntimeControlPlane(true);
  const config = env();
  if (feature === "whatsapp") {
    const whatsapp = whatsappFromEnvironment();
    if (!config.whatsappIntegrationEnabled || !whatsapp) return {
      status: config.whatsappIntegrationEnabled ? "unconfigured" : "disabled",
      checkedAt: new Date().toISOString(), latencyMs: 0, details: "WhatsApp غير مفعّل أو غير مكتمل.",
    } satisfies HealthResult;
    return testWhatsApp(whatsapp);
  }
  if (feature === "sandbox") {
    if (!config.sandboxEnabled || !config.sandboxRunnerUrl) return {
      status: config.sandboxEnabled ? "unconfigured" : "disabled",
      checkedAt: new Date().toISOString(), latencyMs: 0, details: "Sandbox غير مفعّل أو غير مكتمل.",
    } satisfies HealthResult;
    return testRunner(config.sandboxRunnerUrl, "Sandbox Runner");
  }
  if (!config.browserAgentEnabled || !config.browserRunnerUrl) return {
    status: config.browserAgentEnabled ? "unconfigured" : "disabled",
    checkedAt: new Date().toISOString(), latencyMs: 0, details: "Browser Agent غير مفعّل أو غير مكتمل.",
  } satisfies HealthResult;
  return testRunner(config.browserRunnerUrl, "Browser Runner");
}
