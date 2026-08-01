import { createHash } from "node:crypto";
import { db } from "@/db";
import { turnstileVerifications } from "@/db/schema";
import { lt } from "drizzle-orm";
import { ApiError } from "@/lib/http/api";
import { clientIp } from "@/lib/security/client-ip";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TOKEN_MAX_AGE_MS = 5 * 60_000;

type SiteverifyResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  challenge_ts?: string;
  "error-codes"?: string[];
};

export function isTurnstileEnabled() {
  return process.env.TURNSTILE_ENABLED?.trim().toLowerCase() === "true";
}

function configuration() {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME?.trim().toLowerCase();
  if (!secret) throw new Error("TURNSTILE_SECRET_KEY is required when TURNSTILE_ENABLED=true.");
  if (process.env.NODE_ENV === "production" && !expectedHostname) {
    throw new Error("TURNSTILE_EXPECTED_HOSTNAME is required in production when Turnstile is enabled.");
  }
  return { secret, expectedHostname };
}

async function consumeOnce(tokenHash: string, action: string) {
  return db().transaction(async (tx) => {
    await tx.delete(turnstileVerifications).where(lt(turnstileVerifications.expiresAt, new Date()));
    const [created] = await tx.insert(turnstileVerifications).values({
      tokenHash,
      action,
      expiresAt: new Date(Date.now() + TOKEN_MAX_AGE_MS),
    }).onConflictDoNothing().returning({ tokenHash: turnstileVerifications.tokenHash });
    return Boolean(created);
  });
}

export async function verifyTurnstile(input: {
  request: Request;
  token?: string;
  expectedAction: "login" | "register" | "api_key_create";
  fetchImpl?: typeof fetch;
  consumeToken?: (tokenHash: string, action: string) => Promise<boolean>;
  now?: () => number;
}) {
  if (!isTurnstileEnabled()) return { enabled: false as const };
  const token = input.token?.trim();
  if (!token || token.length > 2048) {
    throw new ApiError(422, "TURNSTILE_REQUIRED", "أكمل التحقق الأمني ثم أعد المحاولة.");
  }
  const { secret, expectedHostname } = configuration();
  const body = new URLSearchParams({ secret, response: token });
  const address = clientIp(input.request).address;
  if (address) body.set("remoteip", address);

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new ApiError(503, "TURNSTILE_UNAVAILABLE", "تعذر التحقق الأمني مؤقتًا. حاول مرة أخرى.");
  }
  if (!response.ok) throw new ApiError(503, "TURNSTILE_UNAVAILABLE", "تعذر التحقق الأمني مؤقتًا. حاول مرة أخرى.");
  const result = await response.json().catch(() => null) as SiteverifyResponse | null;
  const challengeTime = result?.challenge_ts ? Date.parse(result.challenge_ts) : Number.NaN;
  const now = (input.now ?? Date.now)();
  if (!result?.success
    || result.action !== input.expectedAction
    || expectedHostname && result.hostname?.toLowerCase() !== expectedHostname
    || !Number.isFinite(challengeTime)
    || now - challengeTime > TOKEN_MAX_AGE_MS
    || challengeTime > now + 30_000) {
    throw new ApiError(422, "TURNSTILE_INVALID", "فشل التحقق الأمني أو انتهت صلاحيته. أعد المحاولة.");
  }
  const tokenHash = createHash("sha256").update(token).digest("hex");
  if (!await (input.consumeToken ?? consumeOnce)(tokenHash, input.expectedAction)) {
    throw new ApiError(409, "TURNSTILE_REPLAYED", "استُخدم التحقق الأمني مسبقًا. أعد التحقق.");
  }
  return { enabled: true as const, hostname: result.hostname };
}
