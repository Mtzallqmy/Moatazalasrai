import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { platformRuntimeSettings } from "@/db/platform-runtime-schema";
import { resetEnvForTests } from "@/lib/config/env";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/security/encryption";

const SETTINGS_ID = "primary";
const WHATSAPP_CONTEXT = "platform-runtime:whatsapp";
const CACHE_TTL_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 12_000;

export const WHATSAPP_ENVIRONMENT_NAMES = [
  "META_APP_ID",
  "META_APP_SECRET",
  "META_GRAPH_API_VERSION",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_DISPLAY_PHONE_NUMBER",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "WHATSAPP_CONNECT_TOKEN_SECRET",
  "APP_URL",
  "PUBLIC_APP_URL",
] as const;

type EnvironmentName = (typeof WHATSAPP_ENVIRONMENT_NAMES)[number];
type EnvironmentValues = Record<EnvironmentName, string | undefined>;

const SECRET_NAMES = new Set<EnvironmentName>([
  "META_APP_SECRET",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "WHATSAPP_CONNECT_TOKEN_SECRET",
]);

const AUTHORITY_NAMES = WHATSAPP_ENVIRONMENT_NAMES.filter(
  (name) => name !== "APP_URL" && name !== "PUBLIC_APP_URL",
);

const COMMON_ALIASES: Partial<Record<EnvironmentName, readonly string[]>> = {
  META_APP_ID: ["WHATSAPP_APP_ID", "FACEBOOK_APP_ID"],
  META_APP_SECRET: ["WHATSAPP_APP_SECRET", "FACEBOOK_APP_SECRET"],
  META_GRAPH_API_VERSION: ["GRAPH_API_VERSION", "FACEBOOK_GRAPH_API_VERSION"],
  WHATSAPP_ACCESS_TOKEN: ["META_ACCESS_TOKEN", "WHATSAPP_TOKEN"],
  WHATSAPP_PHONE_NUMBER_ID: ["PHONE_NUMBER_ID", "META_PHONE_NUMBER_ID"],
  WHATSAPP_BUSINESS_ACCOUNT_ID: ["WABA_ID", "WHATSAPP_WABA_ID"],
  WHATSAPP_DISPLAY_PHONE_NUMBER: ["WHATSAPP_PHONE_NUMBER", "DISPLAY_PHONE_NUMBER"],
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: ["WEBHOOK_VERIFY_TOKEN", "META_WEBHOOK_VERIFY_TOKEN"],
  WHATSAPP_CONNECT_TOKEN_SECRET: ["CONNECT_TOKEN_SECRET", "WHATSAPP_LINK_TOKEN_SECRET"],
  APP_URL: ["NEXTAUTH_URL", "RAILWAY_PUBLIC_URL"],
  PUBLIC_APP_URL: ["NEXT_PUBLIC_APP_URL", "PUBLIC_URL"],
};

export type WhatsAppEnvironmentConfig = {
  appId: string;
  appSecret: string;
  graphApiVersion: string;
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber: string;
  webhookVerifyToken: string;
  connectTokenSecret: string;
  appUrl: string;
  publicAppUrl: string;
};

export type WhatsAppVariableDiagnostic = {
  name: EnvironmentName;
  loaded: boolean;
  displayValue: string | null;
  aliasFound: string | null;
};

export type WhatsAppEnvironmentInspection = {
  authoritative: boolean;
  complete: boolean;
  valid: boolean;
  runtimeEnvironment: string;
  railwayEnvironment: string | null;
  loadedCount: number;
  requiredCount: number;
  missing: EnvironmentName[];
  invalid: Array<{ name: EnvironmentName; reason: string }>;
  warnings: string[];
  variables: WhatsAppVariableDiagnostic[];
  config: WhatsAppEnvironmentConfig | null;
};

export type MetaGraphHealth = {
  status: "healthy" | "unreachable" | "invalid_configuration";
  category:
    | "ok"
    | "invalid_token"
    | "permission"
    | "wrong_phone_number_id"
    | "missing_scope"
    | "rate_limit"
    | "graph_api_error"
    | "network_error"
    | "invalid_configuration";
  checkedAt: string;
  latencyMs: number;
  details: string;
  action: string | null;
  httpStatus: number | null;
  metaCode: number | null;
  metaSubcode: number | null;
  traceId: string | null;
  phone: {
    id: string;
    displayPhoneNumber: string | null;
    verifiedName: string | null;
    qualityRating: string | null;
  } | null;
  webhook: {
    url: string;
    verifyTokenLoaded: boolean;
    subscriptionStatus: "subscribed" | "not_subscribed" | "unknown";
    appIdFound: boolean;
  };
};

export type WhatsAppInitializationReport = {
  checkedAt: string;
  source: "environment" | "database" | "none";
  enabled: boolean;
  persisted: boolean;
  changed: boolean;
  fingerprint: string | null;
  inspection: Omit<WhatsAppEnvironmentInspection, "config">;
  health: MetaGraphHealth | null;
  persistenceError: string | null;
};

type MetaError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  error_user_title?: string;
  error_user_msg?: string;
};

type FetchLike = typeof fetch;

let cachedReport: { report: WhatsAppInitializationReport; expiresAt: number } | null = null;
let initializationPromise: Promise<WhatsAppInitializationReport> | null = null;

function trimmed(name: EnvironmentName) {
  return process.env[name]?.trim() || undefined;
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function validUrl(name: EnvironmentName, value: string, invalid: WhatsAppEnvironmentInspection["invalid"]) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) {
      invalid.push({ name, reason: "يجب ألا يحتوي الرابط بيانات دخول أو query أو fragment." });
      return null;
    }
    if (!["https:", "http:"].includes(url.protocol)) {
      invalid.push({ name, reason: "يجب أن يستخدم الرابط HTTP أو HTTPS." });
      return null;
    }
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
      invalid.push({ name, reason: "يجب أن يستخدم الرابط HTTPS في Production." });
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    invalid.push({ name, reason: "القيمة ليست URL صالحًا." });
    return null;
  }
}

function displayValue(name: EnvironmentName, value: string | undefined) {
  if (!value) return null;
  return SECRET_NAMES.has(name) ? maskSecret(value) : value;
}

export function inspectWhatsAppEnvironment(): WhatsAppEnvironmentInspection {
  const values = Object.fromEntries(
    WHATSAPP_ENVIRONMENT_NAMES.map((name) => [name, trimmed(name)]),
  ) as EnvironmentValues;
  const loadedCount = WHATSAPP_ENVIRONMENT_NAMES.filter((name) => Boolean(values[name])).length;
  const missing = WHATSAPP_ENVIRONMENT_NAMES.filter((name) => !values[name]);
  const authoritative = AUTHORITY_NAMES.some((name) => Boolean(values[name]));
  const invalid: WhatsAppEnvironmentInspection["invalid"] = [];
  const warnings: string[] = [];

  const aliasFor = (name: EnvironmentName) => COMMON_ALIASES[name]?.find((alias) => Boolean(process.env[alias]?.trim())) ?? null;
  const variables = WHATSAPP_ENVIRONMENT_NAMES.map((name) => ({
    name,
    loaded: Boolean(values[name]),
    displayValue: displayValue(name, values[name]),
    aliasFound: values[name] ? null : aliasFor(name),
  }));

  if (values.META_APP_ID && !/^\d{5,30}$/.test(values.META_APP_ID)) {
    invalid.push({ name: "META_APP_ID", reason: "يجب أن يحتوي أرقامًا فقط." });
  }
  if (values.META_APP_SECRET && values.META_APP_SECRET.length < 16) {
    invalid.push({ name: "META_APP_SECRET", reason: "القيمة أقصر من 16 حرفًا." });
  }
  if (values.META_GRAPH_API_VERSION && !/^v\d{1,3}\.\d{1,2}$/.test(values.META_GRAPH_API_VERSION)) {
    invalid.push({ name: "META_GRAPH_API_VERSION", reason: "الصيغة المتوقعة مثل v23.0." });
  }
  if (values.WHATSAPP_ACCESS_TOKEN && values.WHATSAPP_ACCESS_TOKEN.length < 20) {
    invalid.push({ name: "WHATSAPP_ACCESS_TOKEN", reason: "Access Token أقصر من الحد المتوقع." });
  }
  if (values.WHATSAPP_PHONE_NUMBER_ID && !/^\d{5,30}$/.test(values.WHATSAPP_PHONE_NUMBER_ID)) {
    invalid.push({ name: "WHATSAPP_PHONE_NUMBER_ID", reason: "يجب أن يحتوي أرقامًا فقط." });
  }
  if (values.WHATSAPP_BUSINESS_ACCOUNT_ID && !/^\d{5,30}$/.test(values.WHATSAPP_BUSINESS_ACCOUNT_ID)) {
    invalid.push({ name: "WHATSAPP_BUSINESS_ACCOUNT_ID", reason: "يجب أن يحتوي أرقامًا فقط." });
  }
  if (values.WHATSAPP_DISPLAY_PHONE_NUMBER && !/^\d{8,20}$/.test(normalizePhone(values.WHATSAPP_DISPLAY_PHONE_NUMBER))) {
    invalid.push({ name: "WHATSAPP_DISPLAY_PHONE_NUMBER", reason: "رقم العرض غير صالح." });
  }
  if (values.WHATSAPP_WEBHOOK_VERIFY_TOKEN && values.WHATSAPP_WEBHOOK_VERIFY_TOKEN.length < 16) {
    invalid.push({ name: "WHATSAPP_WEBHOOK_VERIFY_TOKEN", reason: "يجب ألا يقل عن 16 حرفًا." });
  }
  if (values.WHATSAPP_CONNECT_TOKEN_SECRET && values.WHATSAPP_CONNECT_TOKEN_SECRET.length < 32) {
    invalid.push({ name: "WHATSAPP_CONNECT_TOKEN_SECRET", reason: "يجب ألا يقل عن 32 حرفًا." });
  }

  const appUrl = values.APP_URL ? validUrl("APP_URL", values.APP_URL, invalid) : null;
  const publicAppUrl = values.PUBLIC_APP_URL ? validUrl("PUBLIC_APP_URL", values.PUBLIC_APP_URL, invalid) : null;
  if (appUrl && publicAppUrl && new URL(appUrl).origin !== new URL(publicAppUrl).origin) {
    warnings.push("APP_URL وPUBLIC_APP_URL يشيران إلى أصلين مختلفين؛ سيستخدم Webhook قيمة PUBLIC_APP_URL.");
  }

  const complete = missing.length === 0;
  const valid = complete && invalid.length === 0;
  const config = valid ? {
    appId: values.META_APP_ID!,
    appSecret: values.META_APP_SECRET!,
    graphApiVersion: values.META_GRAPH_API_VERSION!,
    accessToken: values.WHATSAPP_ACCESS_TOKEN!,
    phoneNumberId: values.WHATSAPP_PHONE_NUMBER_ID!,
    businessAccountId: values.WHATSAPP_BUSINESS_ACCOUNT_ID!,
    displayPhoneNumber: normalizePhone(values.WHATSAPP_DISPLAY_PHONE_NUMBER!),
    webhookVerifyToken: values.WHATSAPP_WEBHOOK_VERIFY_TOKEN!,
    connectTokenSecret: values.WHATSAPP_CONNECT_TOKEN_SECRET!,
    appUrl: appUrl!,
    publicAppUrl: publicAppUrl!,
  } satisfies WhatsAppEnvironmentConfig : null;

  return {
    authoritative,
    complete,
    valid,
    runtimeEnvironment: process.env.NODE_ENV ?? "development",
    railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME?.trim()
      || process.env.RAILWAY_ENVIRONMENT?.trim()
      || null,
    loadedCount,
    requiredCount: WHATSAPP_ENVIRONMENT_NAMES.length,
    missing,
    invalid,
    warnings,
    variables,
    config,
  };
}

function webhookState(config: WhatsAppEnvironmentConfig, status: MetaGraphHealth["webhook"]["subscriptionStatus"] = "unknown", appIdFound = false) {
  return {
    url: `${config.publicAppUrl}/api/webhooks/whatsapp`,
    verifyTokenLoaded: Boolean(config.webhookVerifyToken),
    subscriptionStatus: status,
    appIdFound,
  };
}

export function classifyMetaGraphError(error: MetaError | null, httpStatus: number) {
  const code = error?.code ?? null;
  const subcode = error?.error_subcode ?? null;
  const message = error?.error_user_msg || error?.message || `Meta Graph API HTTP ${httpStatus}`;
  if (code === 190 || httpStatus === 401) {
    return { category: "invalid_token" as const, details: message, action: "أنشئ System User token صالحًا وغير منتهي وتأكد أنه يخص Business الصحيح." };
  }
  if (code === 10 || code === 200 || httpStatus === 403) {
    const missingScope = /permission|scope|whatsapp_business_management|whatsapp_business_messaging/i.test(message);
    return {
      category: missingScope ? "missing_scope" as const : "permission" as const,
      details: message,
      action: "تحقق من صلاحيات whatsapp_business_management وwhatsapp_business_messaging ومن إسناد الأصول إلى System User.",
    };
  }
  if (code === 100 || code === 803 || subcode === 33) {
    return {
      category: "wrong_phone_number_id" as const,
      details: message,
      action: "تحقق أن WHATSAPP_PHONE_NUMBER_ID هو Phone Number ID وليس رقم الهاتف أو WABA ID.",
    };
  }
  if ([4, 17, 32, 613].includes(code ?? -1) || httpStatus === 429) {
    return { category: "rate_limit" as const, details: message, action: "انتظر انتهاء حد Meta ثم أعد الاختبار." };
  }
  return { category: "graph_api_error" as const, details: message, action: "راجع code/subcode وfbtrace_id في لوحة الإدارة وسجلات Railway." };
}

async function timedFetch(url: string, init: RequestInit, fetchImpl: FetchLike) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, cache: "no-store", redirect: "error" });
  } finally {
    clearTimeout(timer);
  }
}

async function responseJson(response: Response) {
  return await response.json().catch(() => null) as Record<string, unknown> | null;
}

export async function testMetaGraphApi(config: WhatsAppEnvironmentConfig, fetchImpl: FetchLike = fetch): Promise<MetaGraphHealth> {
  const started = performance.now();
  const checkedAt = new Date().toISOString();
  const phoneUrl = new URL(`/${config.graphApiVersion}/${config.phoneNumberId}`, "https://graph.facebook.com");
  phoneUrl.searchParams.set("fields", "id,display_phone_number,verified_name,quality_rating,name_status,code_verification_status");
  const headers = { authorization: `Bearer ${config.accessToken}`, accept: "application/json" };

  try {
    const phoneResponse = await timedFetch(phoneUrl.toString(), { headers }, fetchImpl);
    const phonePayload = await responseJson(phoneResponse);
    if (!phoneResponse.ok) {
      const metaError = phonePayload?.error && typeof phonePayload.error === "object" ? phonePayload.error as MetaError : null;
      const classified = classifyMetaGraphError(metaError, phoneResponse.status);
      return {
        status: "unreachable",
        ...classified,
        checkedAt,
        latencyMs: Math.round(performance.now() - started),
        httpStatus: phoneResponse.status,
        metaCode: metaError?.code ?? null,
        metaSubcode: metaError?.error_subcode ?? null,
        traceId: metaError?.fbtrace_id ?? null,
        phone: null,
        webhook: webhookState(config),
      };
    }

    const returnedId = typeof phonePayload?.id === "string" ? phonePayload.id : "";
    if (returnedId !== config.phoneNumberId) {
      return {
        status: "unreachable",
        category: "wrong_phone_number_id",
        checkedAt,
        latencyMs: Math.round(performance.now() - started),
        details: "أعادت Meta كائن Phone Number مختلفًا عن WHATSAPP_PHONE_NUMBER_ID.",
        action: "راجع Phone Number ID في WhatsApp Manager ثم أعد النشر.",
        httpStatus: phoneResponse.status,
        metaCode: null,
        metaSubcode: null,
        traceId: null,
        phone: null,
        webhook: webhookState(config),
      };
    }

    let subscriptionStatus: MetaGraphHealth["webhook"]["subscriptionStatus"] = "unknown";
    let appIdFound = false;
    const subscriptionUrl = new URL(`/${config.graphApiVersion}/${config.businessAccountId}/subscribed_apps`, "https://graph.facebook.com");
    try {
      const subscriptionResponse = await timedFetch(subscriptionUrl.toString(), { headers }, fetchImpl);
      const subscriptionPayload = await responseJson(subscriptionResponse);
      if (subscriptionResponse.ok && Array.isArray(subscriptionPayload?.data)) {
        appIdFound = subscriptionPayload.data.some((item) => {
          if (!item || typeof item !== "object") return false;
          const app = (item as { whatsapp_business_api_data?: { id?: unknown } }).whatsapp_business_api_data;
          return String(app?.id ?? "") === config.appId;
        });
        subscriptionStatus = appIdFound ? "subscribed" : "not_subscribed";
      }
    } catch {
      subscriptionStatus = "unknown";
    }

    const displayPhoneNumber = typeof phonePayload?.display_phone_number === "string" ? phonePayload.display_phone_number : null;
    const verifiedName = typeof phonePayload?.verified_name === "string" ? phonePayload.verified_name : null;
    const qualityRating = typeof phonePayload?.quality_rating === "string" ? phonePayload.quality_rating : null;
    return {
      status: "healthy",
      category: "ok",
      checkedAt,
      latencyMs: Math.round(performance.now() - started),
      details: `${verifiedName ?? "WhatsApp Business"} — ${displayPhoneNumber ?? config.displayPhoneNumber}`,
      action: subscriptionStatus === "not_subscribed" ? "اشترك بالتطبيق في WABA Webhooks من Meta قبل استقبال الرسائل." : null,
      httpStatus: phoneResponse.status,
      metaCode: null,
      metaSubcode: null,
      traceId: null,
      phone: {
        id: returnedId,
        displayPhoneNumber,
        verifiedName,
        qualityRating,
      },
      webhook: webhookState(config, subscriptionStatus, appIdFound),
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      status: "unreachable",
      category: "network_error",
      checkedAt,
      latencyMs: Math.round(performance.now() - started),
      details: timedOut ? "انتهت مهلة الاتصال بـ Meta Graph API." : "تعذر الوصول إلى Meta Graph API من بيئة التشغيل.",
      action: "تحقق من DNS/egress في Railway ثم أعد الاختبار.",
      httpStatus: null,
      metaCode: null,
      metaSubcode: null,
      traceId: null,
      phone: null,
      webhook: webhookState(config),
    };
  }
}

function fingerprint(config: WhatsAppEnvironmentConfig) {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

function applyEnvironment(config: WhatsAppEnvironmentConfig, enabled: boolean) {
  process.env.META_APP_ID = config.appId;
  process.env.META_APP_SECRET = config.appSecret;
  process.env.META_GRAPH_API_VERSION = config.graphApiVersion;
  process.env.WHATSAPP_ACCESS_TOKEN = config.accessToken;
  process.env.WHATSAPP_PHONE_NUMBER_ID = config.phoneNumberId;
  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = config.businessAccountId;
  process.env.WHATSAPP_DISPLAY_PHONE_NUMBER = config.displayPhoneNumber;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = config.webhookVerifyToken;
  process.env.WHATSAPP_CONNECT_TOKEN_SECRET = config.connectTokenSecret;
  process.env.APP_URL = config.appUrl;
  process.env.PUBLIC_APP_URL = config.publicAppUrl;
  process.env.WHATSAPP_INTEGRATION_ENABLED = enabled ? "true" : "false";
  resetEnvForTests();
}

function reportInspection(inspection: WhatsAppEnvironmentInspection): Omit<WhatsAppEnvironmentInspection, "config"> {
  const { config: _config, ...safeInspection } = inspection;
  return safeInspection;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "Unknown persistence error";
}

async function persistInitialization(
  inspection: WhatsAppEnvironmentInspection,
  health: MetaGraphHealth | null,
  enabled: boolean,
) {
  const [row] = await db().select().from(platformRuntimeSettings)
    .where(eq(platformRuntimeSettings.id, SETTINGS_ID)).limit(1);
  const config = inspection.config;
  let changed = false;
  let encrypted = row?.whatsappConfigEncrypted ?? null;
  if (config) {
    let existing: WhatsAppEnvironmentConfig | null = null;
    if (encrypted) {
      try { existing = JSON.parse(decryptSecret(encrypted, WHATSAPP_CONTEXT)) as WhatsAppEnvironmentConfig; }
      catch { existing = null; }
    }
    changed = row?.whatsappManaged !== false
      || row?.whatsappEnabled !== enabled
      || JSON.stringify(existing) !== JSON.stringify(config);
    if (changed || !encrypted) encrypted = encryptSecret(JSON.stringify(config), WHATSAPP_CONTEXT);
  }
  const environmentHealth = {
    status: inspection.valid ? "loaded" : "invalid",
    checkedAt: new Date().toISOString(),
    loadedCount: inspection.loadedCount,
    requiredCount: inspection.requiredCount,
    missing: inspection.missing,
    invalid: inspection.invalid,
    warnings: inspection.warnings,
    railwayEnvironment: inspection.railwayEnvironment,
  };
  const set = {
    whatsappManaged: false,
    whatsappEnabled: enabled,
    whatsappConfigEncrypted: encrypted,
    whatsappConnectTtlMinutes: Number(process.env.WHATSAPP_CONNECT_TOKEN_TTL_MINUTES ?? 10),
    updatedByUserId: null,
    updatedAt: new Date(),
    lastHealth: {
      ...(row?.lastHealth ?? {}),
      whatsappEnvironment: environmentHealth,
      ...(health ? { whatsapp: health } : {}),
    },
  };
  await db().insert(platformRuntimeSettings).values({ id: SETTINGS_ID, ...set })
    .onConflictDoUpdate({ target: platformRuntimeSettings.id, set });
  return changed;
}

function logInitialization(level: "info" | "error", report: WhatsAppInitializationReport) {
  const payload = {
    level,
    event: level === "info" ? "whatsapp.environment.initialized" : "whatsapp.environment.initialization_failed",
    source: report.source,
    enabled: report.enabled,
    loadedCount: report.inspection.loadedCount,
    requiredCount: report.inspection.requiredCount,
    missing: report.inspection.missing,
    invalid: report.inspection.invalid.map((item) => ({ name: item.name, reason: item.reason })),
    railwayEnvironment: report.inspection.railwayEnvironment,
    healthCategory: report.health?.category ?? null,
    metaCode: report.health?.metaCode ?? null,
    metaSubcode: report.health?.metaSubcode ?? null,
    traceId: report.health?.traceId ?? null,
    persistenceError: report.persistenceError,
  };
  const output = JSON.stringify(payload);
  if (level === "info") console.info(output);
  else console.error(output);
}

export async function initializeWhatsAppFromEnvironment(options: { force?: boolean; fetchImpl?: FetchLike } = {}) {
  if (!options.force && cachedReport && cachedReport.expiresAt > Date.now()) return cachedReport.report;
  if (!options.force && initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    const inspection = inspectWhatsAppEnvironment();
    if (!inspection.authoritative) {
      const report: WhatsAppInitializationReport = {
        checkedAt: new Date().toISOString(),
        source: "database",
        enabled: process.env.WHATSAPP_INTEGRATION_ENABLED === "true",
        persisted: false,
        changed: false,
        fingerprint: null,
        inspection: reportInspection(inspection),
        health: null,
        persistenceError: null,
      };
      cachedReport = { report, expiresAt: Date.now() + CACHE_TTL_MS };
      return report;
    }

    if (!inspection.valid || !inspection.config) {
      process.env.WHATSAPP_INTEGRATION_ENABLED = "false";
      resetEnvForTests();
      let persisted = false;
      let persistenceError: string | null = null;
      try { await persistInitialization(inspection, null, false); persisted = true; }
      catch (error) { persistenceError = safeError(error); }
      const report: WhatsAppInitializationReport = {
        checkedAt: new Date().toISOString(),
        source: "environment",
        enabled: false,
        persisted,
        changed: false,
        fingerprint: null,
        inspection: reportInspection(inspection),
        health: null,
        persistenceError,
      };
      logInitialization("error", report);
      cachedReport = { report, expiresAt: Date.now() + CACHE_TTL_MS };
      return report;
    }

    applyEnvironment(inspection.config, false);
    const health = await testMetaGraphApi(inspection.config, options.fetchImpl ?? fetch);
    const enabled = health.status === "healthy";
    applyEnvironment(inspection.config, enabled);
    let persisted = false;
    let changed = false;
    let persistenceError: string | null = null;
    try {
      changed = await persistInitialization(inspection, health, enabled);
      persisted = true;
    } catch (error) {
      persistenceError = safeError(error);
    }
    const report: WhatsAppInitializationReport = {
      checkedAt: new Date().toISOString(),
      source: "environment",
      enabled,
      persisted,
      changed,
      fingerprint: fingerprint(inspection.config).slice(0, 16),
      inspection: reportInspection(inspection),
      health,
      persistenceError,
    };
    logInitialization(enabled && persisted ? "info" : "error", report);
    cachedReport = { report, expiresAt: Date.now() + CACHE_TTL_MS };
    return report;
  })();
  try { return await initializationPromise; }
  finally { initializationPromise = null; }
}

export function requireWhatsAppEnvironmentConfig() {
  const inspection = inspectWhatsAppEnvironment();
  if (!inspection.config) throw new Error("WHATSAPP_ENVIRONMENT_INCOMPLETE");
  return inspection.config;
}

export function invalidateWhatsAppEnvironmentInitialization() {
  cachedReport = null;
  initializationPromise = null;
}
