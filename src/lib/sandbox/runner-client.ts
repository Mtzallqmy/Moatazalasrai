import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/config/env";
import { ApiError } from "@/lib/http/api";

const runnerErrorSchema = z.object({
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
}).passthrough();

const workspaceResponseSchema = z.object({
  workspaceId: z.string().min(1).max(300),
  status: z.enum(["ready", "provisioning"]),
}).strict();

const executionResponseSchema = z.object({
  executionId: z.string().min(1).max(300),
  accepted: z.boolean(),
}).strict();

const fileEntrySchema = z.object({
  path: z.string().min(1).max(1_024),
  isDirectory: z.boolean(),
  sizeBytes: z.number().int().nonnegative(),
  mimeType: z.string().max(200).nullable().optional(),
  sha256: z.string().max(128).nullable().optional(),
  modifiedAt: z.string().datetime().nullable().optional(),
}).strict();

const listFilesResponseSchema = z.object({ files: z.array(fileEntrySchema).max(10_000) }).strict();
const readFileResponseSchema = z.object({
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().max(128).nullable().optional(),
}).strict();

function runnerConfig() {
  const config = env();
  if (!config.sandboxEnabled || !config.sandboxRunnerUrl || !config.sandboxRunnerSharedSecret) {
    throw new ApiError(404, "FEATURE_DISABLED", "ميزة Sandbox غير مفعلة.");
  }
  return { baseUrl: config.sandboxRunnerUrl, secret: config.sandboxRunnerSharedSecret };
}

function signature(secret: string, timestamp: string, nonce: string, method: string, pathname: string, body: string) {
  return createHmac("sha256", secret)
    .update([timestamp, nonce, method.toUpperCase(), pathname, body].join("\n"), "utf8")
    .digest("base64url");
}

async function runnerRequest<T>(input: {
  method?: "GET" | "POST" | "DELETE";
  pathname: string;
  body?: unknown;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}): Promise<T> {
  const { baseUrl, secret } = runnerConfig();
  const method = input.method ?? "POST";
  const body = input.body === undefined ? "" : JSON.stringify(input.body);
  const timestamp = Date.now().toString();
  const nonce = randomUUID();
  const url = new URL(input.pathname, `${baseUrl}/`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const abort = () => controller.abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        "x-moataz-timestamp": timestamp,
        "x-moataz-nonce": nonce,
        "x-moataz-signature": signature(secret, timestamp, nonce, method, url.pathname, body),
      },
      ...(body ? { body } : {}),
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = null;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = null; }
    if (!response.ok) {
      const error = runnerErrorSchema.safeParse(payload);
      throw new ApiError(
        response.status >= 500 ? 502 : response.status,
        error.success ? error.data.error?.code ?? "SANDBOX_RUNNER_ERROR" : "SANDBOX_RUNNER_INVALID_RESPONSE",
        error.success ? error.data.error?.message ?? "رفضت خدمة Sandbox الطلب." : "أعادت خدمة Sandbox استجابة غير صالحة.",
      );
    }
    return input.schema.parse(payload);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "SANDBOX_RUNNER_TIMEOUT", "انتهت مهلة الاتصال بخدمة Sandbox.");
    }
    throw new ApiError(502, "SANDBOX_RUNNER_UNAVAILABLE", "تعذر الاتصال بخدمة Sandbox المعزولة.");
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
  }
}

export function createRunnerWorkspace(input: {
  tenantId: string;
  workspaceId: string;
  template: string;
  diskLimitBytes: number;
  networkMode: string;
}) {
  return runnerRequest({
    pathname: "/v1/workspaces",
    body: input,
    schema: workspaceResponseSchema,
  });
}

export function resetRunnerWorkspace(externalWorkspaceId: string) {
  return runnerRequest({
    pathname: `/v1/workspaces/${encodeURIComponent(externalWorkspaceId)}/reset`,
    body: {},
    schema: workspaceResponseSchema,
  });
}

export function deleteRunnerWorkspace(externalWorkspaceId: string) {
  return runnerRequest({
    method: "DELETE",
    pathname: `/v1/workspaces/${encodeURIComponent(externalWorkspaceId)}`,
    schema: z.object({ deleted: z.literal(true) }).strict(),
  });
}

export function startRunnerExecution(input: {
  tenantId: string;
  workspaceId: string;
  executionId: string;
  command: string;
  workingDirectory: string;
  timeoutMs: number;
  maxOutputBytes: number;
}) {
  return runnerRequest({
    pathname: `/v1/workspaces/${encodeURIComponent(input.workspaceId)}/executions`,
    body: input,
    schema: executionResponseSchema,
  });
}

export function stopRunnerExecution(externalWorkspaceId: string, externalExecutionId: string) {
  return runnerRequest({
    pathname: `/v1/workspaces/${encodeURIComponent(externalWorkspaceId)}/executions/${encodeURIComponent(externalExecutionId)}/stop`,
    body: {},
    schema: z.object({ stopped: z.boolean() }).strict(),
  });
}

export function listRunnerFiles(externalWorkspaceId: string, path: string, depth: number) {
  const query = new URLSearchParams({ path, depth: String(depth) });
  return runnerRequest({
    method: "GET",
    pathname: `/v1/workspaces/${encodeURIComponent(externalWorkspaceId)}/files?${query.toString()}`,
    schema: listFilesResponseSchema,
  });
}

export function readRunnerFile(externalWorkspaceId: string, path: string, maxBytes: number) {
  const query = new URLSearchParams({ path, maxBytes: String(maxBytes) });
  return runnerRequest({
    method: "GET",
    pathname: `/v1/workspaces/${encodeURIComponent(externalWorkspaceId)}/file?${query.toString()}`,
    schema: readFileResponseSchema,
  });
}

export function writeRunnerFile(input: {
  externalWorkspaceId: string;
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  overwrite: boolean;
}) {
  return runnerRequest({
    pathname: `/v1/workspaces/${encodeURIComponent(input.externalWorkspaceId)}/file`,
    body: input,
    schema: fileEntrySchema,
  });
}

export function deleteRunnerFile(input: {
  externalWorkspaceId: string;
  path: string;
  recursive: boolean;
}) {
  const query = new URLSearchParams({ path: input.path, recursive: String(input.recursive) });
  return runnerRequest({
    method: "DELETE",
    pathname: `/v1/workspaces/${encodeURIComponent(input.externalWorkspaceId)}/file?${query.toString()}`,
    schema: z.object({ deleted: z.literal(true) }).strict(),
  });
}

export function verifyRunnerWebhookSignature(input: {
  timestamp: string;
  nonce: string;
  signature: string;
  pathname: string;
  body: string;
}) {
  const { secret } = runnerConfig();
  const age = Math.abs(Date.now() - Number(input.timestamp));
  if (!Number.isFinite(age) || age > 5 * 60_000) return false;
  const expected = Buffer.from(signature(secret, input.timestamp, input.nonce, "POST", input.pathname, input.body));
  const actual = Buffer.from(input.signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
