import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
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
