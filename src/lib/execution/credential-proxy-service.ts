import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { executionJobs } from "@/db/execution-schema";
import { providerCredentials } from "@/db/schema";
import { consumeExecutionCredentialGrant } from "@/lib/execution/credential-grant-service";
import { ExecutionError } from "@/lib/execution/errors";
import { assertAllowedEgressUrl, normalizeNetworkPolicy } from "@/lib/execution/network-policy-service";
import { resolveProviderApiKey } from "@/lib/providers/provider-config";

const operationRoutes: Record<string, { method: "POST"; suffixes: string[] }> = {
  "responses.create": { method: "POST", suffixes: ["/responses"] },
  "chat.completions.create": { method: "POST", suffixes: ["/chat/completions"] },
  "anthropic.messages.create": { method: "POST", suffixes: ["/messages"] },
  "gemini.generateContent": { method: "POST", suffixes: [":generateContent"] },
};

export const credentialProxyRequestSchema = z.object({
  grantToken: z.string().min(32).max(200),
  jobId: z.string().uuid(),
  operation: z.string().min(3).max(100),
  url: z.string().url().max(2_048),
  method: z.literal("POST"),
  headers: z.record(z.string().max(100), z.string().max(4_096)).default({}),
  body: z.string().max(2 * 1024 * 1024),
}).strict();
export type CredentialProxyRequest = z.infer<typeof credentialProxyRequestSchema>;

const forbiddenHeader = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-goog-api-key|connection|host|content-length|transfer-encoding|forwarded|x-forwarded-)/i;

function proxySecret() {
  const value = process.env.EXECUTION_PROXY_SHARED_SECRET?.trim();
  if (!value || value.length < 32) throw new ExecutionError("EXECUTION_CREDENTIAL_FORBIDDEN", "سر Proxy الداخلي غير مهيأ.");
  return value;
}

function bodyHash(body: string) {
  return createHash("sha256").update(body, "utf8").digest("base64url");
}

function expectedSignature(timestamp: string, nonce: string, service: string, method: string, pathname: string, hash: string) {
  return createHmac("sha256", proxySecret())
    .update([timestamp, nonce, service, method.toUpperCase(), pathname, hash].join("\n"), "utf8")
    .digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyCredentialProxySignature(input: {
  timestamp: string | null;
  nonce: string | null;
  service: string | null;
  bodyHash: string | null;
  signature: string | null;
  method: string;
  pathname: string;
  body: string;
}) {
  if (!input.timestamp || !input.nonce || !input.service || !input.bodyHash || !input.signature) return false;
  if (input.service !== "execution-runner") return false;
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(input.nonce)) return false;
  const age = Math.abs(Date.now() - Number(input.timestamp));
  if (!Number.isFinite(age) || age > 5 * 60_000) return false;
  const calculatedHash = bodyHash(input.body);
  if (!safeEqual(calculatedHash, input.bodyHash)) return false;
  return safeEqual(
    expectedSignature(input.timestamp, input.nonce, input.service, input.method, input.pathname, calculatedHash),
    input.signature,
  );
}

function sanitizeForwardHeaders(headers: Record<string, string>) {
  const result: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.trim().toLowerCase();
    if (!normalized || forbiddenHeader.test(normalized)) continue;
    if (!/^[a-z0-9-]{1,100}$/.test(normalized)) continue;
    result[normalized] = value;
  }
  return result;
}

function assertOperationRoute(operation: string, url: URL, method: string) {
  const route = operationRoutes[operation];
  if (!route || route.method !== method) {
    throw new ExecutionError("EXECUTION_CREDENTIAL_FORBIDDEN", "العملية غير مدعومة بواسطة Proxy التنفيذ.");
  }
  if (!route.suffixes.some((suffix) => url.pathname.endsWith(suffix))) {
    throw new ExecutionError("EXECUTION_CREDENTIAL_FORBIDDEN", "مسار المزود لا يطابق العملية الممنوحة.");
  }
}

function credentialHeaders(input: {
  provider: string;
  apiKey: string;
  existing: Record<string, string>;
}) {
  if (input.provider === "anthropic") {
    return { ...input.existing, "x-api-key": input.apiKey, "anthropic-version": input.existing["anthropic-version"] ?? "2023-06-01" };
  }
  if (input.provider === "gemini") {
    return { ...input.existing, "x-goog-api-key": input.apiKey };
  }
  return { ...input.existing, authorization: `Bearer ${input.apiKey}` };
}

async function readResponseBody(response: Response, maximum: number) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new ExecutionError("EXECUTION_LIMIT_EXCEEDED", "تجاوز رد المزود حد البيانات المسموح.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export async function proxyCredentialRequest(input: CredentialProxyRequest) {
  const parsedUrl = new URL(input.url);
  assertOperationRoute(input.operation, parsedUrl, input.method);
  const consumed = await consumeExecutionCredentialGrant({
    token: input.grantToken,
    jobId: input.jobId,
    host: parsedUrl.hostname,
    operation: input.operation,
  });
  const [row] = await db().select({
    job: executionJobs,
    credential: providerCredentials,
  }).from(executionJobs)
    .innerJoin(providerCredentials, and(
      eq(providerCredentials.id, consumed.credentialId),
      eq(providerCredentials.organizationId, executionJobs.organizationId),
    ))
    .where(and(
      eq(executionJobs.id, input.jobId),
      eq(executionJobs.organizationId, consumed.organizationId),
    )).limit(1);
  if (!row || !row.credential.enabled || row.credential.validationStatus !== "verified") {
    throw new ExecutionError("EXECUTION_CREDENTIAL_FORBIDDEN", "بيانات اعتماد المزود لم تعد صالحة.");
  }
  const credentialBase = new URL(row.credential.baseUrl);
  if (credentialBase.hostname.toLowerCase() !== parsedUrl.hostname.toLowerCase()) {
    throw new ExecutionError("EXECUTION_CREDENTIAL_FORBIDDEN", "المضيف لا يطابق مزود بيانات الاعتماد.");
  }
  const maximumNetworkBytes = typeof consumed.budget.maxNetworkBytes === "number"
    ? Math.min(Math.max(consumed.budget.maxNetworkBytes, 1_024), 10 * 1024 * 1024)
    : 2 * 1024 * 1024;
  const policy = normalizeNetworkPolicy({
    mode: "allowlist",
    allowedHosts: [parsedUrl.hostname],
    allowedPorts: [parsedUrl.port ? Number(parsedUrl.port) : parsedUrl.protocol === "https:" ? 443 : 80],
    allowDns: true,
    allowedMethods: ["POST"],
    maxRequests: 1,
  });
  await assertAllowedEgressUrl({ policy, url: input.url, method: input.method });
  const apiKey = resolveProviderApiKey(row.credential, consumed.organizationId);
  const headers = credentialHeaders({
    provider: row.credential.provider,
    apiKey,
    existing: sanitizeForwardHeaders(input.headers),
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(parsedUrl, {
      method: "POST",
      headers,
      body: input.body,
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      throw new ExecutionError("EXECUTION_NETWORK_DENIED", "رفض Proxy تحويل المزود إلى عنوان آخر.");
    }
    const body = await readResponseBody(response, maximumNetworkBytes);
    return {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type")?.slice(0, 200) ?? "application/octet-stream",
        "request-id": response.headers.get("request-id")?.slice(0, 200) ?? response.headers.get("x-request-id")?.slice(0, 200) ?? "",
      },
      body,
      bytes: body.byteLength,
    };
  } catch (error) {
    if (error instanceof ExecutionError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ExecutionError("EXECUTION_RUNNER_TIMEOUT", "انتهت مهلة طلب المزود عبر Proxy.", true);
    }
    throw new ExecutionError("EXECUTION_RUNNER_UNAVAILABLE", "تعذر الوصول إلى المزود عبر Proxy.", true);
  } finally {
    clearTimeout(timeout);
  }
}
