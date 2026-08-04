import { ApiError } from "@/lib/http/api";
import { clientIp } from "@/lib/security/client-ip";

const FIXED_WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

type RateLimitInput = {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
};

type MemoryEntry = { count: number; expiresAt: number };
const memory = new Map<string, MemoryEntry>();
let warnedAboutMemory = false;

async function hashKey(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function redisConfiguration() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

function validateInput(input: RateLimitInput) {
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(input.scope)) throw new Error("RATE_LIMIT_SCOPE_INVALID");
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000_000) throw new Error("RATE_LIMIT_LIMIT_INVALID");
  if (!Number.isSafeInteger(input.windowMs) || input.windowMs < 1_000 || input.windowMs > 86_400_000) throw new Error("RATE_LIMIT_WINDOW_INVALID");
}

async function distributedLimit(input: RateLimitInput, configuration: { url: string; token: string }) {
  const bucket = Math.floor(Date.now() / input.windowMs);
  const key = `moataz:rate:${input.scope}:${bucket}:${await hashKey(input.key)}`;
  const response = await fetch(configuration.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${configuration.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(["EVAL", FIXED_WINDOW_SCRIPT, "1", key, String(input.windowMs)]),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`RATE_LIMIT_REDIS_HTTP_${response.status}`);
  const payload = await response.json() as { result?: unknown; error?: string };
  if (payload.error) throw new Error("RATE_LIMIT_REDIS_COMMAND_FAILED");
  if (!Array.isArray(payload.result) || payload.result.length < 2) throw new Error("RATE_LIMIT_REDIS_RESPONSE_INVALID");
  const count = Number(payload.result[0]);
  const ttlMs = Math.max(1, Number(payload.result[1]));
  if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) throw new Error("RATE_LIMIT_REDIS_RESPONSE_INVALID");
  return { count, ttlMs };
}

function memoryLimit(input: RateLimitInput, id: string) {
  const now = Date.now();
  const existing = memory.get(id);
  const entry = !existing || existing.expiresAt <= now
    ? { count: 1, expiresAt: now + input.windowMs }
    : { count: existing.count + 1, expiresAt: existing.expiresAt };
  memory.set(id, entry);
  return { count: entry.count, ttlMs: Math.max(1, entry.expiresAt - now) };
}

export function requestClientKey(request: Request, fallback = "anonymous") {
  return clientIp(request).address ?? fallback;
}

export async function consumeRateLimit(input: RateLimitInput) {
  validateInput(input);
  const configuration = redisConfiguration();
  let state: { count: number; ttlMs: number };
  if (configuration) {
    state = await distributedLimit(input, configuration);
  } else {
    if (process.env.NODE_ENV === "production") {
      throw new ApiError(503, "RATE_LIMIT_BACKEND_UNAVAILABLE", "خدمة الحماية من كثرة الطلبات غير مهيأة.");
    }
    if (!warnedAboutMemory) {
      warnedAboutMemory = true;
      console.warn(JSON.stringify({ level: "warn", event: "rate_limit.memory_fallback" }));
    }
    const bucket = Math.floor(Date.now() / input.windowMs);
    state = memoryLimit(input, `${input.scope}:${bucket}:${await hashKey(input.key)}`);
  }
  const retryAfter = Math.max(1, Math.ceil(state.ttlMs / 1_000));
  return {
    allowed: state.count <= input.limit,
    limit: input.limit,
    remaining: Math.max(0, input.limit - state.count),
    retryAfter,
  };
}

export async function enforceRateLimit(input: RateLimitInput) {
  const result = await consumeRateLimit(input);
  if (!result.allowed) {
    throw new ApiError(429, "RATE_LIMITED", "عدد المحاولات كبير. حاول مرة أخرى لاحقًا.", {
      retryAfter: result.retryAfter,
      limit: result.limit,
    });
  }
  return result;
}

export function resetRateLimitsForTests() {
  memory.clear();
  warnedAboutMemory = false;
}
