import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, organizationMembers, organizations, users } from "@/db/schema";
import { issueMobileSession } from "@/lib/auth/mobile";
import { hashPassword } from "@/lib/auth/password";
import { ApiError, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";
import { supabaseAuthConfigured } from "@/lib/supabase/config";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(12).max(128),
  deviceId: z.string().trim().min(8).max(200),
  deviceName: z.string().trim().min(1).max(200).optional(),
  rememberSession: z.boolean().default(true),
}).strict();

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    if (supabaseAuthConfigured()) throw new ApiError(410, "SUPABASE_AUTH_REQUIRED", "سجّل الحساب بواسطة Supabase Auth ثم تحقق من جلسة التطبيق.");
    const body = await parseJson(request, schema, 16 * 1024);
    const clientKey = requestClientKey(request);
    await enforceRateLimit({ scope: "mobile.register.ip", key: clientKey, limit: 5, windowMs: 60 * 60_000 });
    await enforceRateLimit({ scope: "mobile.register.email", key: body.email, limit: 3, windowMs: 60 * 60_000 });
    const existing = await db().select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
    if (existing[0]) throw new ApiError(409, "REGISTRATION_UNAVAILABLE", "تعذر إنشاء الحساب بهذه البيانات.");
    const [organization] = await db().select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.publicRegistrationEnabled, true))
      .limit(1);
    if (!organization) {
      throw new ApiError(503, "REGISTRATION_CLOSED", "التسجيل العام غير مفعّل حاليًا.");
    }
    const passwordHash = await hashPassword(body.password);
    const user = await db().transaction(async (tx) => {
      const [created] = await tx.insert(users).values({
        email: body.email,
        name: body.name,
        passwordHash,
      }).returning({ id: users.id, email: users.email, name: users.name });
      if (!created) throw new Error("USER_CREATE_FAILED");
      await tx.insert(organizationMembers).values({
        organizationId: organization.id,
        userId: created.id,
        role: "member",
      });
      await tx.insert(auditLogs).values({
        organizationId: organization.id,
        actorType: "user",
        actorId: created.id,
        action: "auth.mobile_register",
        resourceType: "user",
        resourceId: created.id,
        metadata: { requestId, assignedRole: "member" },
      });
      return created;
    });
    const tokens = await issueMobileSession({
      userId: user.id,
      organizationId: organization.id,
      deviceId: body.deviceId,
      deviceName: body.deviceName,
      rememberSession: body.rememberSession,
    });
    return apiSuccess({
      tokens,
      user,
      organization: { ...organization, role: "member" },
    }, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/mobile/v1/auth/register");
  }
}
