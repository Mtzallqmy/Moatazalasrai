import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, organizationMembers, organizations, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

function requestId(request: Request) {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

export async function POST(request: Request) {
  const id = requestId(request);
  try {
    const body = (await request.json()) as { name?: string; email?: string; password?: string; organizationName?: string };
    const name = body.name?.trim();
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? "";
    const organizationName = body.organizationName?.trim();

    if (!name || name.length < 2 || !email || !email.includes("@") || !organizationName || organizationName.length < 2) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "تحقق من الاسم والبريد واسم المؤسسة.", requestId: id } }, { status: 400 });
    }

    const existing = await db().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing[0]) {
      return NextResponse.json({ success: false, error: { code: "EMAIL_EXISTS", message: "البريد الإلكتروني مستخدم بالفعل.", requestId: id } }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const userRows = await db().insert(users).values({ email, name, passwordHash }).returning({ id: users.id });
    const user = userRows[0];
    if (!user) throw new Error("تعذر إنشاء المستخدم.");

    const slugBase = organizationName.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";
    const slug = `${slugBase}-${crypto.randomUUID().slice(0, 8)}`;
    const orgRows = await db().insert(organizations).values({ name: organizationName, slug }).returning({ id: organizations.id });
    const organization = orgRows[0];
    if (!organization) throw new Error("تعذر إنشاء المؤسسة.");

    await db().insert(organizationMembers).values({ organizationId: organization.id, userId: user.id, role: "owner" });
    await db().insert(auditLogs).values({ organizationId: organization.id, actorType: "user", actorId: user.id, action: "auth.register", resourceType: "user", resourceId: user.id, metadata: {} });

    const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const userAgent = request.headers.get("user-agent") ?? undefined;
    const metadata: { ipAddress?: string; userAgent?: string } = {};
    if (ipAddress) metadata.ipAddress = ipAddress;
    if (userAgent) metadata.userAgent = userAgent;
    await createSession(user.id, metadata);

    return NextResponse.json({ success: true, data: { userId: user.id, organizationId: organization.id }, meta: { requestId: id } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر إنشاء الحساب.";
    return NextResponse.json({ success: false, error: { code: "REGISTRATION_FAILED", message, requestId: id } }, { status: 500 });
  }
}
