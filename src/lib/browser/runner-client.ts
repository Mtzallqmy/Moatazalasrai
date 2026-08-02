import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import type { BrowserPlan } from "@/lib/browser/contracts";
import { env } from "@/lib/config/env";
import { ApiError } from "@/lib/http/api";

const storageStateSchema = z.object({
  cookies: z.array(z.record(z.string(), z.unknown())).max(5_000),
  origins: z.array(z.record(z.string(), z.unknown())).max(1_000),
}).passthrough();

const loginStartResponseSchema = z.object({
  sessionId: z.string().min(1).max(300),
  interactiveUrl: z.string().url(),
  expiresAt: z.string().datetime(),
}).strict();

const loginStatusResponseSchema = z.object({
  status: z.enum(["active", "completed", "cancelled", "expired", "failed"]),
  storageState: storageStateSchema.optional(),
  currentUrl: z.string().url().optional(),
  errorCode: z.string().optional(),
}).strict();

const taskStartResponseSchema = z.object({
  taskId: z.string().min(1).max(300),
  accepted: z.boolean(),
}).strict();

const runnerTaskEventSchema = z.object({
  sequence: z.number().int().positive(),
  type: z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
}).strict();

const taskStatusResponseSchema = z.object({
  taskId: z.string(),
  status: z.enum(["running", "completed", "failed", "cancelled", "expired"]),
  currentStep: z.number().int().nonnegative(),
  errorCode: z.string().nullable().optional(),
  events: z.array(runnerTaskEventSchema).max(500),
  storageState: storageStateSchema.optional(),
}).strict();

function browserConfig() {
  const config = env();
  if (!config.browserAgentEnabled || !config.browserRunnerUrl || !config.browserRunnerSharedSecret) {
    throw new ApiError(404, "FEATURE_DISABLED", "ميزة متصفح الوكيل غير مفعلة.");
  }
  return { baseUrl: config.browserRunnerUrl, secret: config.browserRunnerSharedSecret };
}

function sign(secret: string, timestamp: string, nonce: string, method: string, pathname: string, body: string) {
  return createHmac("sha256", secret)
    .update([timestamp, nonce, method.toUpperCase(), pathname, body].join("\n"), "utf8")
    .digest("base64url");
}

async function browserRunnerRequest<T>(input: {
  method?: "GET" | "POST" | "DELETE";
  pathname: string;
  body?: unknown;
  schema: z.ZodType<T>;
  timeoutMs?: number;
}) {
  const { baseUrl, secret } = browserConfig();
  const method = input.method ?? "POST";
  const body = input.body === undefined ? "" : JSON.stringify(input.body);
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const url = new URL(input.pathname, `${baseUrl}/`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        "x-moataz-timestamp": timestamp,
        "x-moataz-nonce": nonce,
        "x-moataz-signature": sign(secret, timestamp, nonce, method, url.pathname, body),
      },
      ...(body ? { body } : {}),
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = null; }
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: { message?: string } }).error?.message
        : undefined;
      throw new ApiError(response.status >= 500 ? 502 : response.status, "BROWSER_RUNNER_ERROR", message ?? "رفضت خدمة المتصفح الطلب.");
    }
    return input.schema.parse(payload);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "BROWSER_RUNNER_TIMEOUT", "انتهت مهلة الاتصال بخدمة المتصفح.");
    }
    throw new ApiError(502, "BROWSER_RUNNER_UNAVAILABLE", "تعذر الاتصال بخدمة المتصفح المعزولة.");
  } finally {
    clearTimeout(timeout);
  }
}

export function startInteractiveBrowserLogin(input: {
  tenantId: string;
  connectionId: string;
  startUrl: string;
  allowedDomains: string[];
  maxPages: number;
}) {
  return browserRunnerRequest({
    pathname: "/v1/login-sessions",
    body: input,
    schema: loginStartResponseSchema,
  });
}

export function getInteractiveBrowserLogin(input: { tenantId: string; sessionId: string }) {
  const query = new URLSearchParams({ tenantId: input.tenantId });
  return browserRunnerRequest({
    method: "GET",
    pathname: `/v1/login-sessions/${encodeURIComponent(input.sessionId)}?${query}`,
    schema: loginStatusResponseSchema,
  });
}

export function cancelInteractiveBrowserLogin(input: { tenantId: string; sessionId: string }) {
  const query = new URLSearchParams({ tenantId: input.tenantId });
  return browserRunnerRequest({
    method: "DELETE",
    pathname: `/v1/login-sessions/${encodeURIComponent(input.sessionId)}?${query}`,
    schema: z.object({ cancelled: z.boolean() }).strict(),
  });
}

export function startBrowserRunnerTask(input: {
  tenantId: string;
  taskId: string;
  storageState: Record<string, unknown>;
  plan: BrowserPlan;
  allowedDomains: string[];
  maxPages: number;
  timeoutMs: number;
  maxDownloadBytes: number;
}) {
  return browserRunnerRequest({
    pathname: "/v1/tasks",
    body: input,
    schema: taskStartResponseSchema,
  });
}

export function getBrowserRunnerTask(input: { tenantId: string; taskId: string; after: number }) {
  const query = new URLSearchParams({ tenantId: input.tenantId, after: String(input.after) });
  return browserRunnerRequest({
    method: "GET",
    pathname: `/v1/tasks/${encodeURIComponent(input.taskId)}?${query}`,
    schema: taskStatusResponseSchema,
  });
}

export function cancelBrowserRunnerTask(input: { tenantId: string; taskId: string }) {
  const query = new URLSearchParams({ tenantId: input.tenantId });
  return browserRunnerRequest({
    method: "DELETE",
    pathname: `/v1/tasks/${encodeURIComponent(input.taskId)}?${query}`,
    schema: z.object({ cancelled: z.boolean() }).strict(),
  });
}
