import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, organizationMembers, organizations, users } from "@/db/schema";
import { bootstrapAuthorized } from "@/lib/auth/api-key";
import { hashPassword } from "@/lib/auth/password";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  if (!bootstrapAuthorized(request)) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "رمز التهيئة غير صالح.", requestId } }, { status: 401 });
  }

  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_INITIAL_PASSWORD;
  const name = process.env.OWNER_NAME?.trim() || "معتز العلقمي";
  const organizationName = process.env.OWNER_ORGANIZATION_NAME?.trim() || "Moataz Agent Platform";

  if (!email || !password) {
    return NextResponse.json({ success: false, error: { code: "MISSING_OWNER_ENV", message: "اضبط OWNER_EMAIL وOWNER_INITIAL_PASSWORD في متغيرات Railway.", requestId } }, { status: 500 });
  }

  const existing = await db().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) {
    return NextResponse.json({ success: false, error: { code: "OWNER_EXISTS", message: "حساب المالك موجود بالفعل. احذف متغير كلمة المرور الأولية من Railway.", requestId } }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const slug = `moataz-${crypto.randomUUID().slice(0, 8)}`;

  const [user] = await db().insert(users).values({ email, name, passwordHash }).returning({ id: users.id, email: users.email, name: users.name });
  if (!user) throw new Error("تعذر إنشاء حساب المالك.");

  const [organization] = await db().insert(organizations).values({ name: organizationName, slug }).returning({ id: organizations.id, name: organizations.name });
  if (!organization) throw new Error("تعذر إنشاء مؤسسة المالك.");

  await db().insert(organizationMembers).values({ organizationId: organization.id, userId: user.id, role: "owner" });
  await db().insert(auditLogs).values({
    organizationId: organization.id,
    actorType: "bootstrap",
    actorId: user.id,
    action: "owner.bootstrapped",
    resourceType: "user",
    resourceId: user.id,
    metadata: { email: user.email },
  });

  return NextResponse.json({
    success: true,
    data: { user, organization, role: "owner" },
    meta: { requestId, securityAction: "احذف OWNER_INITIAL_PASSWORD ودوّر BOOTSTRAP_ADMIN_TOKEN فورًا." },
  }, { status: 201 });
}
