import { createHash, createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/config/env";
import { ApiError } from "@/lib/http/api";

const runnerErrorSchema = z.object({
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
}).passthrough();

const healthResponseSchema = z.object({
  ok: z.boolean(),
  activeExecutions: z.number().int().nonnegative(),
  protocolVersion: z.number().int().positive().optional(),
  argvExecution: z.boolean().optional(),
  networkIsolation: z.boolean().optional(),
}).passthrough();

const workspaceResponseSchema = z.object({
  workspaceId: z.string().min(1).max(300),
  status: z.enum(["ready", "provisioning"]),
}).strict();

const executionResponseSchema = z.object({
  executionId: z.string().min(1).max(300),
  accepted: z.boolean(),
}).strict();

const runnerEventSchema = z.object({
  sequence: z.number().int().positive(),
  type: z.string().min(1).max(100),
  stream: z.enum(["stdout", "stderr"]).optional(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
}).strict();

const executionSnapshotSchema = z.object({
  executionId: z.string().min(1).max(300),
  status: z.enum(["running", "completed", "failed", "cancelled", "timed_out"]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  exitCode: z.number().int().nullable(),
  signal: z.string().max(100).nullable().optional(),
  outputTruncated: z.boolean(),
  stdoutBytes: z.number().int().nonnegative(),
  stderrBytes: z.number().int().nonnegative(),
  events: z.array(runnerEventSchema).max(500),
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
  if (!config.sandboxRunnerUrl || !config.sandboxRunnerSharedSecret) {
    throw new ApiError(404, "SANDBOX_RUNNER_NOT_CONFIGURED", "خدمة التنفيذ المعزولة غير مهيأة.");
  }
  return { baseUrl: config.sandboxRunnerUrl, secret: config.sandboxRunnerSharedSecret };
}

function bodySha256(body: string) {
  return createHash("sha256").update(body, "utf8").digest("base64url");
}

function signature(secret: string, timestamp: string, nonce: string, service: string, method: string, pathname: string, bodyHash: string) {
  return createHmac("sha256", secret)
    .update([timestamp, nonce, service, method.toUpperCase(), pathname, bodyHash].join("\n"), "utf8")
    .digest("base64url");
}

async function runnerRequest<T>(input: {
  method?: "GET" | "POST" | "DELETE";
  pathname: string;
  body?: unknown;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
  authenticated?: boolean;
  timeoutMs?: number;
  service?: "platform-execution-kernel" | "platform-sandbox";
}): Promise<T> {
  const { baseUrl, secret } = runnerConfig();
  const method = input.method ?? "POST";
  const body = input.body === undefined ? "" : JSON.stringify(input.body);
  const timestamp = Date.now().toString();
  const nonce = randomUUID();
  const service = input.service ?? "platform-sandbox";
  const hash = bodySha256(body);
  const url = new URL(input.pathname, `${baseUrl}/`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);
  const abort = () => controller.abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    const authenticated = input.authenticated !== false;
    const response = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...(authenticated ? {
          "x-moataz-timestamp": timestamp,
          "x-moataz-nonce": nonce,
          "x-moataz-body-sha256": hash,
          "x-moataz-signature": signature(secret, timestamp, nonce, service, method, url.pathname, hash),
          "x-moataz-service": service,
        } : {}),
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
        error.success ? error.data.error?.message ?? "رفضت خدمة التنفيذ الطلب." : "أعادت خدمة التنفيذ استجابة غير صالحة.",
      );
    }
    return input.schema.parse(payload);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "SANDBOX_RUNNER_TIMEOUT", "انتهت مهلة الاتصال بخدمة التنفيذ المعزولة.");
    }
    throw new ApiError(502, "SANDBOX_RUNNER_UNAVAILABLE", "تعذر الاتصال بخدمة التنفيذ المعزولة.");
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
  }
}

export function getRunnerHealth() {
  return runnerRequest({
    method: "GET",
    pathname: "/health",
    schema: healthResponseSchema,
    authenticated: false,
    timeoutMs: 10_000,
  });
}

export function createRunnerWorkspace(input: {
  tenantId: string;
  workspaceId: string;
  template: string;
  diskLimitBytes: number;
  networkMode: string;
}) {
  return runnerRequest({ pathname: "/v1/workspaces", body: input, schema: workspaceResponseSchema });
}

export function resetRunnerWorkspace(input: { tenantId: string; externalWorkspaceId: string }) {
  return runnerRequest({
    pathname: `/v1/workspaces/${encodeURIComponent(input.externalWorkspaceId)}/reset`,
    body: { tenantId: input.tenantId },
    schema: workspaceResponseSchema,
  });
}

export function deleteRunnerWorkspace(input: { tenantId: string; externalWorkspaceId: string }) {
  const query = new URLSearchParams({ tenantId: input.tenantId });
  return runnerRequest({
    method: "DELETE",
    pathname: `/v1/workspaces/${encodeURIComponent(input.externalWorkspaceId)}?${query.toString()}`,
    schema: z.object({ deleted: z.literal(true) }).strict(),
  });
}

type LegacyExecutionRequest = {
  tenantId: string;
  workspaceId: string;
  executionId: string;
  command: string;
  workingDirectory: string;
  timeoutMs: number;
  maxOutputBytes: number;
};

type ArgvExecutionRequest = {
  tenantId: string;
  workspaceId: string;
  executionId: string;
  argv: string[];
  workingDirectory: string;
  timeoutMs: number;
  maxOutputBytes: number;
  environment?: Record<string, string>;
  stdin?: string;
};

export function startRunnerExecution(input: LegacyExecutionRequest | ArgvExecutionRequest) {
  return runnerRequest({
    pathname: `/v1/workspaces/${encodeURIComponent(input.workspaceId)}/executions`,
    body: input,
    schema: executionResponseSchema,
    service: "argv" in input ? "platform-execution-kernel" : "platform-sandbox",
  });
}

export function getRunnerExecution(input: {
  tenantId: string;
  externalWorkspaceId: string;
  externalExecutionId: string;
  after: number;
}) {
  const query = new URLSearchParams({ tenantId: input.tenantId, after: String(input.after) });
  return runnerRequest({
    method: "GET",
    pathname: `/v1/workspaces/${encodeURIComponent(input.externalWorkspaceId)}/executions/${encodeURIComponent(input.externalExecutionId)}?${query.toString()}`,
    schema: executionSnapshotSchema,
  });
}

export function stopRunnerExecution(input: {
  tenantId: string;
  externalWorkspaceId: string;
  externalExecutionId: string;
}) {
  return runnerRequest({
    pathname: `/v1/workspaces/${encodeURIComponent(input.externalWorkspaceId)}/executions/${encodeURIComponent(input.externalExecutionId)}/stop`,
    body: { tenantId: input.tenantId },
    schema: z.object({ stopped: z.boolean() }).strict(),
  });
}

export function listRunnerFiles(input: { tenantId: string; externalWorkspaceId: string; path: string; depth: number }) {
  const query = new URLSearchParams({ tenantId: input.tenantId, path: input.path, depth: String(input.depth) });
  return runnerRequest({
    method: "GET",
    pathname: `/v1/workspaces/${encodeURIComponent(input.externalWorkspaceId)}/files?${query.toString()}`,
    schema: listFilesResponseSchema,
  });
}

export function readRunnerFile(input: { tenantId: string; externalWorkspaceId: string; path: string; maxBytes: number }) {
  const query = new URLSearchParams({ tenantId: input.tenantId, path: input.path, maxBytes: String(input.maxBytes) });
  return runnerRequest({
    method: "GET",
    pathname: `/v1/workspaces/${encodeURIComponent(input.externalWorkspaceId)}/file?${query.toString()}`,
    schema: readFileResponseSchema,
    timeoutMs: 60_000,
  });
}

export function writeRunnerFile(input: {
  tenantId: string;
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
    timeoutMs: 60_000,
  });
}

export function deleteRunnerFile(input: {
  tenantId: string;
  externalWorkspaceId: string;
  path: string;
  recursive: boolean;
}) {
  const query = new URLSearchParams({ tenantId: input.tenantId, path: input.path, recursive: String(input.recursive) });
  return runnerRequest({
    method: "DELETE",
    pathname: `/v1/workspaces/${encodeURIComponent(input.externalWorkspaceId)}/file?${query.toString()}`,
    schema: z.object({ deleted: z.literal(true) }).strict(),
  });
}
