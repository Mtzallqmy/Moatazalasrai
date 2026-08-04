import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { databaseRows } from "@/db/result";
import { bootstrapAdminTokens } from "@/db/security-schema";
import { ApiError } from "@/lib/http/api";
import { recordDeniedAccess } from "@/lib/security/audit";
import { clientIp } from "@/lib/security/client-ip";
import { hashApiKey, secureHashEquals } from "@/lib/security/encryption";

type Database = ReturnType<typeof db>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function configuration() {
  const token = process.env.BOOTSTRAP_ADMIN_TOKEN?.trim();
  const expiresAtRaw = process.env.BOOTSTRAP_ADMIN_TOKEN_EXPIRES_AT?.trim();
  if (!token || token.length < 32) {
    throw new ApiError(503, "BOOTSTRAP_TOKEN_DISABLED", "رمز التهيئة غير مفعّل أو أقصر من الحد الآمن.");
  }
  if (!expiresAtRaw) {
    throw new ApiError(503, "BOOTSTRAP_TOKEN_EXPIRY_REQUIRED", "يجب تحديد وقت انتهاء رمز التهيئة.");
  }
  const expiresAt = new Date(expiresAtRaw);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new ApiError(503, "BOOTSTRAP_TOKEN_EXPIRY_INVALID", "وقت انتهاء رمز التهيئة غير صالح.");
  }
  return { token, tokenHash: hashApiKey(token), expiresAt };
}

export async function withConsumedBootstrapToken<T>(input: {
  request: Request;
  requestId: string;
  operation: (tx: Transaction) => Promise<T>;
}) {
  const config = configuration();
  const supplied = input.request.headers.get("x-bootstrap-token")?.trim() ?? "";
  const ipHash = hashApiKey(clientIp(input.request).address ?? "unknown");
  if (!supplied || !secureHashEquals(config.tokenHash, supplied)) {
    await recordDeniedAccess({ reason: "BOOTSTRAP_TOKEN_INVALID", requestId: input.requestId, route: new URL(input.request.url).pathname });
    throw new ApiError(401, "UNAUTHORIZED", "رمز التهيئة غير صالح.");
  }
  if (config.expiresAt <= new Date()) {
    await recordDeniedAccess({ reason: "BOOTSTRAP_TOKEN_EXPIRED", requestId: input.requestId, route: new URL(input.request.url).pathname });
    throw new ApiError(401, "BOOTSTRAP_TOKEN_EXPIRED", "انتهت صلاحية رمز التهيئة.");
  }

  return db().transaction(async (tx) => {
    await tx.insert(bootstrapAdminTokens).values({
      id: "admin",
      tokenHash: config.tokenHash,
      expiresAt: config.expiresAt,
    }).onConflictDoNothing();
    const lock = await tx.execute(sql`
      SELECT "id" FROM "bootstrap_admin_tokens"
      WHERE "id" = 'admin'
      FOR UPDATE
    `);
    if (databaseRows(lock).length === 0) throw new Error("BOOTSTRAP_CONTROL_MISSING");
    const [state] = await tx.select().from(bootstrapAdminTokens)
      .where(eq(bootstrapAdminTokens.id, "admin")).limit(1);
    if (!state) throw new Error("BOOTSTRAP_CONTROL_MISSING");
    if (state.permanentlyDisabled || state.disabledAt) {
      throw new ApiError(403, "BOOTSTRAP_TOKEN_PERMANENTLY_DISABLED", "تم تعطيل التهيئة نهائيًا.");
    }
    if (state.usedAt) {
      throw new ApiError(409, "BOOTSTRAP_TOKEN_ALREADY_USED", "استُخدم رمز التهيئة سابقًا.");
    }
    if (!state.tokenHash || state.tokenHash !== config.tokenHash) {
      throw new ApiError(409, "BOOTSTRAP_TOKEN_ROTATION_REJECTED", "لا يمكن تدوير رمز التهيئة بعد إنشاء سجل التحكم.");
    }
    if (!state.expiresAt || state.expiresAt <= new Date()) {
      throw new ApiError(401, "BOOTSTRAP_TOKEN_EXPIRED", "انتهت صلاحية رمز التهيئة.");
    }
    await tx.update(bootstrapAdminTokens).set({
      usedAt: new Date(),
      usedRequestId: input.requestId,
      usedIpHash: ipHash,
      updatedAt: new Date(),
    }).where(eq(bootstrapAdminTokens.id, "admin"));
    return input.operation(tx);
  });
}
