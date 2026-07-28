import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, organizationMembers, users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? "";
    if (!email || !password) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "أدخل البريد وكلمة المرور.", requestId } }, { status: 400 });
    }

    const rows = await db().select().from(users).where(eq(users.email, email)).limit(1);
    const user = rows[0];
    const valid = Boolean(user?.passwordHash) && await verifyPassword(password, user!.passwordHash!);
    if (!user || !valid) {
      return NextResponse.json({ success: false, error: { code: "INVALID_CREDENTIALS", message: "بيانات الدخول غير صحيحة.", requestId } }, { status: 401 });
    }

    const membership = await db().select({ organizationId: organizationMembers.organizationId }).from(organizationMembers).where(eq(organizationMembers.userId, user.id)).limit(1);
    await createSession(user.id, {
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    await db().insert(auditLogs).values({ organizationId: membership[0]?.organizationId, actorType: "user", actorId: user.id, action: "auth.login", resourceType: "session", metadata: {} });

    return NextResponse.json({ success: true, data: { user: { id: user.id, name: user.name, email: user.email } }, meta: { requestId } });
  } catch {
    return NextResponse.json({ success: false, error: { code: "LOGIN_FAILED", message: "تعذر تسجيل الدخول حاليًا.", requestId } }, { status: 500 });
  }
}
