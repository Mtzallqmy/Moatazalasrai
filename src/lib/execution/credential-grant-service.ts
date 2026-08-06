import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { executionCredentialGrants, executionJobs } from "@/db/execution-schema";
import { providerCredentials } from "@/db/schema";
import { ExecutionError } from "@/lib/execution/errors";
import { normalizeHostname } from "@/lib/execution/network-policy-service";

function hashToken(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function grantTtlSeconds() {
  const value = Number(process.env.EXECUTION_CREDENTIAL_GRANT_TTL_SECONDS ?? 300);
  return Number.isSafeInteger(value) ? Math.min(Math.max(value, 30), 900) : 300;
}

export async function issueExecutionCredentialGrant(input: {
  organizationId: string;
  userId: string;
  jobId: string;
  credentialId: string;
  allowedHosts: string[];
  allowedOperations: string[];
  budget: Record<string, unknown>;
}) {
  if (process.env.EXECUTION_CREDENTIAL_BROKER_ENABLED === "false") {
    throw new ExecutionError("EXECUTION_CREDENTIAL_FORBIDDEN", "وسيط بيانات الاعتماد غير مفعّل.");
  }
  const hosts = Array.from(new Set(input.allowedHosts.map(normalizeHostname)));
  const operations = Array.from(new Set(input.allowedOperations.map((value) => value.trim()).filter(Boolean)));
  if (!hosts.length || !operations.length) {
    throw new ExecutionError("EXECUTION_CREDENTIAL_FORBIDDEN", "يتطلب Grant مضيفين وعمليات محددة صراحةً.");
  }
  const [row] = await db().select({
    jobId: executionJobs.id,
    credentialId: providerCredentials.id,
    providerKind: providerCredentials.provider,
  }).from(executionJobs)
    .innerJoin(providerCredentials, and(
      eq(providerCredentials.id, input.credentialId),
      eq(providerCredentials.organizationId, executionJobs.organizationId),
      eq(providerCredentials.enabled, true),
      eq(providerCredentials.validationStatus, "verified"),
    ))
    .where(and(
      eq(executionJobs.id, input.jobId),
      eq(executionJobs.organizationId, input.organizationId),
      eq(executionJobs.userId, input.userId),
    )).limit(1);
  if (!row) throw new ExecutionError("EXECUTION_CREDENTIAL_FORBIDDEN", "بيانات الاعتماد غير متاحة لهذه العملية.");

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + grantTtlSeconds() * 1_000);
  const [grant] = await db().insert(executionCredentialGrants).values({
    organizationId: input.organizationId,
    jobId: input.jobId,
    credentialId: input.credentialId,
    providerKind: row.providerKind,
    allowedHosts: hosts,
    allowedOperations: operations,
    budget: input.budget,
    tokenHash: hashToken(token),
    expiresAt,
  }).returning({ id: executionCredentialGrants.id });
  if (!grant) throw new Error("EXECUTION_GRANT_CREATE_FAILED");
  return { grantId: grant.id, token, expiresAt };
}

export async function consumeExecutionCredentialGrant(input: {
  token: string;
  jobId: string;
  host: string;
  operation: string;
}) {
  const hash = hashToken(input.token);
  const now = new Date();
  return db().transaction(async (tx) => {
    const [grant] = await tx.select().from(executionCredentialGrants).where(and(
      eq(executionCredentialGrants.jobId, input.jobId),
      eq(executionCredentialGrants.tokenHash, hash),
      isNull(executionCredentialGrants.revokedAt),
      gt(executionCredentialGrants.expiresAt, now),
    )).for("update").limit(1);
    if (!grant) throw new ExecutionError("EXECUTION_GRANT_INVALID", "Grant غير صالح أو منتهي.");
    const supplied = Buffer.from(hash);
    const stored = Buffer.from(grant.tokenHash);
    if (supplied.length !== stored.length || !timingSafeEqual(supplied, stored)) {
      throw new ExecutionError("EXECUTION_GRANT_INVALID", "Grant غير صالح.");
    }
    const host = normalizeHostname(input.host);
    if (!grant.allowedHosts.includes(host) || !grant.allowedOperations.includes(input.operation)) {
      throw new ExecutionError("EXECUTION_CREDENTIAL_FORBIDDEN", "Grant لا يسمح بهذا المضيف أو العملية.");
    }
    const [consumed] = await tx.update(executionCredentialGrants).set({ revokedAt: now }).where(and(
      eq(executionCredentialGrants.id, grant.id),
      isNull(executionCredentialGrants.revokedAt),
    )).returning();
    if (!consumed) throw new ExecutionError("EXECUTION_GRANT_REPLAYED", "تم استخدام Grant سابقًا.");
    return {
      grantId: grant.id,
      organizationId: grant.organizationId,
      credentialId: grant.credentialId,
      providerKind: grant.providerKind,
      budget: grant.budget,
    };
  });
}

export async function revokeExecutionCredentialGrants(input: { organizationId: string; jobId: string }) {
  await db().update(executionCredentialGrants).set({ revokedAt: new Date() }).where(and(
    eq(executionCredentialGrants.organizationId, input.organizationId),
    eq(executionCredentialGrants.jobId, input.jobId),
    isNull(executionCredentialGrants.revokedAt),
  ));
}
