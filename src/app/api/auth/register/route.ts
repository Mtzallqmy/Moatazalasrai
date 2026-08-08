import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, organizationMembers, organizations, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { publishDomainEventBestEffort } from "@/lib/events/publish";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { registerSchema } from "@/lib/http/contracts";
import { anonymizeIp, clientIp } from "@/lib/security/client-ip";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { supabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureLocalIdentity, supabaseSessionIdFromAccessToken, upsertSupabaseAppSession } from "@/lib/auth/supabase-identity";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const body = await parseJson(request, registerSchema, 16 * 1024);
    const clientKey = requestClientKey(request);
    await enforceRateLimit({ scope: "auth.register.ip", key: clientKey, limit: 5, windowMs: 60 * 60_000 });
    await enforceRateLimit({ scope: "auth.register.email", key: body.email, limit: 3, windowMs: 60 * 60_000 });
    await verifyTurnstile({ request, token: body.turnstileToken, expectedAction: "register" });

    if (supabaseAuthConfigured()) {
      const [registrationOrganization] = await db().select({ id: organizations.id }).from(organizations)
        .where(eq(organizations.publicRegistrationEnabled, true)).limit(1);
      if (!registrationOrganization) throw new ApiError(503, "REGISTRATION_CLOSED", "التسجيل العام غير مفعّل حاليًا. راجع مدير المنصة.");
      const supabase = await createSupabaseServerClient();
      const callback = new URL("/auth/callback", process.env.PUBLIC_APP_URL ?? process.env.APP_URL ?? request.url);
      callback.searchParams.set("next", "/dashboard");
      const { data: signup, error } = await supabase.auth.signUp({
        email: body.email,
        password: body.password,
        options: { emailRedirectTo: callback.toString(), data: { full_name: body.name } },
      });
      if (error) throw new ApiError(400, "AUTH_SIGNUP_FAILED", "تعذر إنشاء حساب المصادقة. تحقق من البريد وكلمة المرور.");
      if (!signup.user) throw new ApiError(502, "AUTH_SIGNUP_FAILED", "لم يُرجع مزود المصادقة حسابًا صالحًا.");
      if (!signup.session) {
        return apiSuccess({ confirmationRequired: true }, requestId, 202);
      }
      const local = await ensureLocalIdentity(signup.user);
      const appSession = await upsertSupabaseAppSession({
        userId: local.id,
        supabaseSessionId: supabaseSessionIdFromAccessToken(signup.session.access_token),
        expiresAt: new Date((signup.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000),
        ipAddress: anonymizeIp(clientIp(request).address),
        userAgent: request.headers.get("user-agent") ?? undefined,
      });
      return apiSuccess({ userId: local.id, organizationSelectionRequired: appSession.organizationSelectionRequired }, requestId, 201);
    }

    const existing = await db().select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
    if (existing[0]) {
      throw new ApiError(409, "REGISTRATION_UNAVAILABLE", "تعذر إنشاء الحساب بهذه البيانات.");
    }

    const [platformOrganization] = await db().select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.publicRegistrationEnabled, true))
      .limit(1);
    if (!platformOrganization) {
      throw new ApiError(503, "REGISTRATION_CLOSED", "التسجيل العام غير مفعّل حاليًا. راجع مدير المنصة.");
    }
    const passwordHash = await hashPassword(body.password);

    const created = await db().transaction(async (tx) => {
      const [user] = await tx.insert(users).values({
        email: body.email,
        name: body.name,
        passwordHash,
      }).returning({ id: users.id });
      if (!user) throw new Error("USER_CREATE_FAILED");

      await tx.insert(organizationMembers).values({
        organizationId: platformOrganization.id,
        userId: user.id,
        role: "member",
      });
      await tx.insert(auditLogs).values({
        organizationId: platformOrganization.id,
        actorType: "user",
        actorId: user.id,
        action: "auth.register",
        resourceType: "user",
        resourceId: user.id,
        metadata: { requestId, assignedRole: "member" },
      });
      return { userId: user.id, organizationId: platformOrganization.id, role: "member" as const };
    });

    await createSession({
      userId: created.userId,
      activeOrganizationId: created.organizationId,
      ipAddress: anonymizeIp(clientIp(request).address),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    await publishDomainEventBestEffort({
      organizationId: created.organizationId,
      eventKey: "user.registered",
      actorType: "user",
      actorId: created.userId,
      resourceType: "user",
      resourceId: created.userId,
      idempotencyKey: `user.registered:${created.userId}`,
      payload: {
        userId: created.userId,
        name: body.name,
        email: body.email,
        role: created.role,
      },
    });
    return apiSuccess(created, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/auth/register");
  }
}
