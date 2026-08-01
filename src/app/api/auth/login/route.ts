import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, organizationMembers, users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson, ApiError } from "@/lib/http/api";
import { loginSchema } from "@/lib/http/contracts";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";
import { anonymizeIp, clientIp } from "@/lib/security/client-ip";
import { verifyTurnstile } from "@/lib/security/turnstile";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const body = await parseJson(request, loginSchema, 8 * 1024);
    const clientKey = requestClientKey(request);
    await enforceRateLimit({ scope: "auth.login.ip", key: clientKey, limit: 10, windowMs: 15 * 60_000 });
    await enforceRateLimit({ scope: "auth.login.email", key: body.email, limit: 8, windowMs: 15 * 60_000 });
    await verifyTurnstile({ request, token: body.turnstileToken, expectedAction: "login" });

    const [user] = await db().select().from(users).where(eq(users.email, body.email)).limit(1);
    if (!user?.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "بيانات الدخول غير صحيحة.");
    }

    const memberships = await db()
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, user.id))
      .orderBy(asc(organizationMembers.createdAt))
      .limit(2);
    const activeOrganizationId = memberships.length === 1 ? memberships[0].organizationId : undefined;

    await createSession({
      userId: user.id,
      activeOrganizationId,
      ipAddress: anonymizeIp(clientIp(request).address),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    await db().insert(auditLogs).values({
      organizationId: activeOrganizationId,
      actorType: "user",
      actorId: user.id,
      action: "auth.login",
      resourceType: "session",
      metadata: { requestId },
    });

    return apiSuccess({
      user: { id: user.id, name: user.name, email: user.email },
      organizationSelectionRequired: memberships.length !== 1,
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/auth/login");
  }
}
