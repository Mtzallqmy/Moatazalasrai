import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, organizations, sessions, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, revokeAllSessions } from "@/lib/auth/session";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { accountMutationSchema } from "@/lib/http/contracts";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";
import { supabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    const body = await parseJson(request, accountMutationSchema, 8 * 1024);
    if (body.action === "profile") {
      const [updated] = await db().update(users).set({ name: body.name, updatedAt: new Date() })
        .where(eq(users.id, session.userId))
        .returning({ id: users.id, name: users.name, email: users.email });
      return apiSuccess(updated, requestId);
    }
    if (body.action === "organization") {
      if (!["owner", "admin"].includes(session.role)) {
        throw new ApiError(403, "FORBIDDEN", "لا تملك صلاحية تعديل المؤسسة.");
      }
      const [updated] = await db().update(organizations).set({ name: body.name, updatedAt: new Date() })
        .where(eq(organizations.id, session.organizationId))
        .returning({ id: organizations.id, name: organizations.name, slug: organizations.slug });
      await db().insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "organization.updated",
        resourceType: "organization",
        resourceId: session.organizationId,
        metadata: { requestId },
      });
      return apiSuccess(updated, requestId);
    }

    const clientKey = requestClientKey(request);
    await enforceRateLimit({
      scope: "account.password",
      key: `${session.userId}:${clientKey}`,
      limit: 5,
      windowMs: 60 * 60_000,
    });
    if (supabaseAuthConfigured()) {
      const supabase = await createSupabaseServerClient();
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email: session.email, password: body.currentPassword });
      if (verifyError) throw new ApiError(401, "INVALID_CREDENTIALS", "كلمة المرور الحالية غير صحيحة.");
      const { error: updateError } = await supabase.auth.updateUser({ password: body.newPassword });
      if (updateError) throw new ApiError(502, "PASSWORD_UPDATE_FAILED", "تعذر تحديث كلمة المرور لدى مزود المصادقة.");
      await db().transaction(async (tx) => {
        await tx.update(users).set({ passwordHash: null, updatedAt: new Date() }).where(eq(users.id, session.userId));
        await tx.insert(auditLogs).values({
          organizationId: session.organizationId,
          actorType: "user",
          actorId: session.userId,
          action: "account.supabase_password_changed",
          resourceType: "user",
          resourceId: session.userId,
          metadata: { requestId },
        });
      });
      return apiSuccess({ passwordChanged: true, authenticationSource: "supabase" }, requestId);
    }
    const [user] = await db().select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, session.userId)).limit(1);
    if (!user?.passwordHash || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "كلمة المرور الحالية غير صحيحة.");
    }
    const passwordHash = await hashPassword(body.newPassword);
    await db().transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, session.userId));
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(
        eq(sessions.userId, session.userId),
        isNull(sessions.revokedAt),
      ));
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "account.password_changed",
        resourceType: "user",
        resourceId: session.userId,
        metadata: { requestId },
      });
    });
    await revokeAllSessions(session.userId);
    await createSession({
      userId: session.userId,
      activeOrganizationId: session.organizationId,
      ipAddress: clientKey,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return apiSuccess({ passwordChanged: true, sessionsRotated: true }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/account");
  }
}
