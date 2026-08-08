import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, organizationMembers, users } from "@/db/schema";
import { verifyMfaForLogin } from "@/lib/auth/mfa";
import { verifyPassword } from "@/lib/auth/password";
import { markCurrentSessionReauthenticated } from "@/lib/auth/reauthentication";
import { createSession } from "@/lib/auth/session";
import { publishDomainEventBestEffort } from "@/lib/events/publish";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson, ApiError } from "@/lib/http/api";
import { loginSchema } from "@/lib/http/contracts";
import { anonymizeIp, clientIp } from "@/lib/security/client-ip";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { activeMembership } from "@/lib/auth/membership-access";
import { supabaseAuthConfigured } from "@/lib/supabase/config";
import { signInWithSupabasePassword } from "@/lib/auth/supabase-password";
import { ensureLocalIdentity, supabaseSessionIdFromAccessToken, upsertSupabaseAppSession } from "@/lib/auth/supabase-identity";

export const runtime = "nodejs";

const loginWithMfaSchema = loginSchema.extend({
  mfaCode: z.string().trim().min(6).max(32).optional(),
});

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const body = await parseJson(request, loginWithMfaSchema, 8 * 1024);
    const clientKey = requestClientKey(request);
    await enforceRateLimit({ scope: "auth.login.ip", key: clientKey, limit: 10, windowMs: 15 * 60_000 });
    await enforceRateLimit({ scope: "auth.login.email", key: body.email, limit: 8, windowMs: 15 * 60_000 });
    await verifyTurnstile({ request, token: body.turnstileToken, expectedAction: "login" });

    if (supabaseAuthConfigured()) {
      const authenticated = await signInWithSupabasePassword(body.email, body.password);
      const local = await ensureLocalIdentity(authenticated.user);
      const mfaVerified = await verifyMfaForLogin({ userId: local.id, code: body.mfaCode });
      const appSession = await upsertSupabaseAppSession({
        userId: local.id,
        supabaseSessionId: supabaseSessionIdFromAccessToken(authenticated.session.access_token),
        expiresAt: new Date((authenticated.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000),
        ipAddress: anonymizeIp(clientIp(request).address),
        userAgent: request.headers.get("user-agent") ?? undefined,
      });
      if (mfaVerified) await markCurrentSessionReauthenticated();
      return apiSuccess({
        user: { id: local.id, name: local.name, email: local.email },
        organizationSelectionRequired: appSession.organizationSelectionRequired,
      }, requestId);
    }

    const [user] = await db().select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
    }).from(users).where(eq(users.email, body.email)).limit(1);
    if (!user?.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "بيانات الدخول غير صحيحة.");
    }
    const mfaVerified = await verifyMfaForLogin({ userId: user.id, code: body.mfaCode });

    const memberships = await db()
      .select({ organizationId: organizationMembers.organizationId, expiresAt: organizationMembers.expiresAt })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.userId, user.id), activeMembership()))
      .orderBy(asc(organizationMembers.createdAt))
      .limit(2);
    if (memberships.length === 0) {
      throw new ApiError(403, "ACCOUNT_ACCESS_EXPIRED", "انتهت صلاحية استخدام الحساب أو أوقفه مدير المؤسسة.");
    }
    const activeOrganizationId = memberships.length === 1 ? memberships[0].organizationId : undefined;

    await createSession({
      userId: user.id,
      activeOrganizationId,
      accessExpiresAt: memberships.length === 1 ? memberships[0].expiresAt : null,
      ipAddress: anonymizeIp(clientIp(request).address),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    if (mfaVerified) await markCurrentSessionReauthenticated();
    await db().insert(auditLogs).values({
      organizationId: activeOrganizationId,
      actorType: "user",
      actorId: user.id,
      action: "auth.login",
      resourceType: "session",
      metadata: { requestId, mfaVerified },
    });
    if (activeOrganizationId) {
      await publishDomainEventBestEffort({
        organizationId: activeOrganizationId,
        eventKey: "user.logged_in",
        actorType: "user",
        actorId: user.id,
        resourceType: "session",
        idempotencyKey: `user.logged_in:${requestId}`,
        payload: { userId: user.id, name: user.name, email: user.email },
      });
    }

    return apiSuccess({
      user: { id: user.id, name: user.name, email: user.email },
      organizationSelectionRequired: memberships.length !== 1,
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/auth/login");
  }
}
