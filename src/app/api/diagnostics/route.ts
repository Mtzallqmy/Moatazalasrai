import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { integrations, providerCredentials, runs } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";
import { env } from "@/lib/config/env";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const criticalRoutes = [
  { path: "/", category: "public" },
  { path: "/login", category: "auth" },
  { path: "/register", category: "auth" },
  { path: "/dashboard", category: "protected" },
  { path: "/dashboard/providers", category: "protected" },
  { path: "/api/health", category: "system" },
  { path: "/api/ready", category: "system" },
  { path: "/api/auth/login", category: "api" },
  { path: "/api/auth/register", category: "api" },
  { path: "/api/dashboard/providers", category: "api" },
  { path: "/api/v1/agents", category: "api" },
  { path: "/api/v1/runs", category: "api" },
] as const;

type Check = {
  name: string;
  status: "pass" | "fail";
  latencyMs: number;
  details: string;
};

function nowMs(): number {
  return performance.now();
}

async function runCheck(name: string, action: () => Promise<string> | string): Promise<Check> {
  const started = nowMs();
  try {
    const details = await action();
    return { name, status: "pass", latencyMs: Math.round(nowMs() - started), details };
  } catch (error) {
    return {
      name,
      status: "fail",
      latencyMs: Math.round(nowMs() - started),
      details: error instanceof Error ? error.message : "فشل غير معروف",
    };
  }
}

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const session = await currentSession();
  if (!session?.organizationId || !session.role || !new Set(["owner", "admin"]).has(session.role)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "التشخيص متاح لمالك المؤسسة والمدير فقط.",
          requestId,
        },
      },
      { status: 403 },
    );
  }

  const checks = await Promise.all([
    runCheck("runtime-environment", () => {
      const config = env();
      return `NODE_ENV=${config.nodeEnv}; LOG_LEVEL=${config.logLevel}`;
    }),
    runCheck("database", async () => {
      await db().execute(sql`select 1`);
      return "PostgreSQL متاح ويستجيب";
    }),
    runCheck("encryption", () => {
      const sample = `diagnostic-${crypto.randomUUID()}`;
      const envelope = encryptSecret(sample);
      if (decryptSecret(envelope) !== sample) throw new Error("فشل تحقق التشفير");
      return "AES-256-GCM يعمل بصورة صحيحة";
    }),
    runCheck("session", () => `جلسة صالحة للمستخدم ${session.email}`),
    runCheck("tenant-scope", () => `المؤسسة الحالية: ${session.organizationId}`),
    runCheck("providers", async () => {
      const [totalRows, degradedRows] = await Promise.all([
        db().select({ value: count() }).from(providerCredentials).where(eq(providerCredentials.organizationId, session.organizationId)),
        db().select({ value: count() }).from(providerCredentials).where(and(
          eq(providerCredentials.organizationId, session.organizationId),
          inArray(providerCredentials.validationStatus, ["pending", "failed"]),
        )),
      ]);
      return `${totalRows[0]?.value ?? 0} مزود؛ ${degradedRows[0]?.value ?? 0} يحتاج انتباهًا`;
    }),
    runCheck("integrations", async () => {
      const [totalRows, failedRows] = await Promise.all([
        db().select({ value: count() }).from(integrations).where(eq(integrations.organizationId, session.organizationId)),
        db().select({ value: count() }).from(integrations).where(and(
          eq(integrations.organizationId, session.organizationId),
          eq(integrations.status, "failed"),
        )),
      ]);
      return `${totalRows[0]?.value ?? 0} تكامل؛ ${failedRows[0]?.value ?? 0} فاشل`;
    }),
    runCheck("runs-24h", async () => {
      const since = new Date(Date.now() - 24 * 60 * 60_000);
      const [totalRows, failedRows] = await Promise.all([
        db().select({ value: count() }).from(runs).where(and(eq(runs.organizationId, session.organizationId), gte(runs.createdAt, since))),
        db().select({ value: count() }).from(runs).where(and(
          eq(runs.organizationId, session.organizationId),
          gte(runs.createdAt, since),
          inArray(runs.status, ["failed", "cancelled"]),
        )),
      ]);
      return `${totalRows[0]?.value ?? 0} تشغيل؛ ${failedRows[0]?.value ?? 0} فشل/إلغاء`;
    }),
  ]);

  const failed = checks.filter((check) => check.status === "fail").length;
  return NextResponse.json(
    {
      success: failed === 0,
      data: {
        status: failed === 0 ? "healthy" : "degraded",
        checkedAt: new Date().toISOString(),
        checks,
        routes: criticalRoutes,
        summary: { total: checks.length, passed: checks.length - failed, failed },
      },
      meta: { requestId },
    },
    { status: failed === 0 ? 200 : 503 },
  );
}
