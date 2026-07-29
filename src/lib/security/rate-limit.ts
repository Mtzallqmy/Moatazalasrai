import { createHash } from "node:crypto";
import { rateLimits } from "@/db/schema";
import { db } from "@/db";
import { ApiError } from "@/lib/http/api";
import { sql } from "drizzle-orm";

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function requestClientKey(request: Request, fallback = "anonymous") {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("cf-connecting-ip") || fallback;
}

export async function enforceRateLimit(input: {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
}) {
  const now = Date.now();
  const windowStartedAt = new Date(Math.floor(now / input.windowMs) * input.windowMs);
  const expiresAt = new Date(windowStartedAt.getTime() + input.windowMs * 2);
  const [row] = await db()
    .insert(rateLimits)
    .values({
      scope: input.scope,
      keyHash: hashKey(input.key),
      windowStartedAt,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [rateLimits.scope, rateLimits.keyHash, rateLimits.windowStartedAt],
      set: {
        count: sql`${rateLimits.count} + 1`,
        expiresAt,
      },
    })
    .returning({ count: rateLimits.count });

  if ((row?.count ?? input.limit + 1) > input.limit) {
    const retryAfter = Math.max(1, Math.ceil((windowStartedAt.getTime() + input.windowMs - now) / 1000));
    throw new ApiError(429, "RATE_LIMITED", "عدد المحاولات كبير. حاول مرة أخرى لاحقًا.", { retryAfter });
  }
}
