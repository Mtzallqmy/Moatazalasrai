import { createHmac, randomUUID } from "node:crypto";
import { env } from "@/lib/config/env";
import { ApiError } from "@/lib/http/api";

type RunnerFeature = "sandbox" | "browser";

type RunnerHealthResult = {
  status: "healthy" | "disabled" | "unconfigured" | "unreachable" | "unauthorized";
  checkedAt: string;
  latencyMs: number;
  details: string;
};

function sign(secret: string, timestamp: string, nonce: string, method: string, pathname: string, body = "") {
  return createHmac("sha256", secret)
    .update([timestamp, nonce, method.toUpperCase(), pathname, body].join("\n"), "utf8")
    .digest("base64url");
}

async function timedFetch(url: URL, init: RequestInit, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store", redirect: "error" });
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeAuthenticatedRunner(input: {
  feature: RunnerFeature;
  runnerUrl: string;
  sharedSecret: string;
}): Promise<RunnerHealthResult> {
  const started = performance.now();
  const label = input.feature === "sandbox" ? "Sandbox Runner" : "Browser Runner";
  try {
    const base = new URL(input.runnerUrl);
    const probePath = "/v1/moataz-auth-health-probe";
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const probeUrl = new URL(probePath, `${base.toString().replace(/\/$/, "")}/`);
    const probe = await timedFetch(probeUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-moataz-timestamp": timestamp,
        "x-moataz-nonce": nonce,
        "x-moataz-signature": sign(input.sharedSecret, timestamp, nonce, "GET", probePath),
      },
    });
    const probePayload = await probe.json().catch(() => null) as { error?: { code?: string } } | null;
    if (probe.status === 401 || probePayload?.error?.code === "UNAUTHORIZED") {
      return {
        status: "unauthorized",
        checkedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        details: `تعذر مصادقة ${label}. تحقق من السر المشترك في المنصة والـRunner.`,
      };
    }
    // The authenticated probe intentionally targets an unknown /v1 route. A signed
    // request must pass authentication and reach the runner router, which returns 404.
    if (probe.status !== 404) {
      throw new Error(`${label} authentication probe returned HTTP ${probe.status}.`);
    }

    const healthUrl = new URL("/health", `${base.toString().replace(/\/$/, "")}/`);
    const health = await timedFetch(healthUrl, { method: "GET", headers: { accept: "application/json" } });
    const payload = await health.json().catch(() => null) as { ok?: boolean; activeExecutions?: number; loginSessions?: number; taskSessions?: number } | null;
    if (!health.ok || payload?.ok !== true) throw new Error(`${label} health endpoint is not healthy.`);
    const activity = input.feature === "sandbox"
      ? `التنفيذات النشطة: ${payload.activeExecutions ?? 0}`
      : `جلسات الدخول: ${payload.loginSessions ?? 0}، مهام المتصفح: ${payload.taskSessions ?? 0}`;
    return {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started),
      details: `${label} متاح وتم التحقق من السر المشترك. ${activity}`,
    };
  } catch (error) {
    return {
      status: "unreachable",
      checkedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started),
      details: error instanceof Error && error.name === "AbortError"
        ? `انتهت مهلة الاتصال بـ ${label}.`
        : `تعذر التحقق من ${label}.`,
    };
  }
}

export async function testCurrentAuthenticatedRunner(feature: RunnerFeature): Promise<RunnerHealthResult> {
  const config = env();
  const enabled = feature === "sandbox" ? config.sandboxEnabled : config.browserAgentEnabled;
  const runnerUrl = feature === "sandbox" ? config.sandboxRunnerUrl : config.browserRunnerUrl;
  const sharedSecret = feature === "sandbox" ? config.sandboxRunnerSharedSecret : config.browserRunnerSharedSecret;
  if (!enabled) {
    return { status: "disabled", checkedAt: new Date().toISOString(), latencyMs: 0, details: `${feature === "sandbox" ? "Sandbox" : "Browser Agent"} غير مفعّل.` };
  }
  if (!runnerUrl || !sharedSecret) {
    return { status: "unconfigured", checkedAt: new Date().toISOString(), latencyMs: 0, details: "إعدادات الـRunner غير مكتملة." };
  }
  return probeAuthenticatedRunner({ feature, runnerUrl, sharedSecret });
}

export async function assertRunnerConnection(input: { feature: RunnerFeature; runnerUrl?: string; sharedSecret?: string }) {
  if (!input.runnerUrl || !input.sharedSecret) return;
  const result = await probeAuthenticatedRunner({ feature: input.feature, runnerUrl: input.runnerUrl, sharedSecret: input.sharedSecret });
  if (result.status !== "healthy") {
    throw new ApiError(422, input.feature === "sandbox" ? "SANDBOX_AUTH_HEALTH_FAILED" : "BROWSER_AUTH_HEALTH_FAILED", result.details);
  }
}
