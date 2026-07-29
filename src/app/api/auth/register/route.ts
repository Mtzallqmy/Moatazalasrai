import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, organizationMembers, organizations, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { registerSchema } from "@/lib/http/contracts";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const body = await parseJson(request, registerSchema, 16 * 1024);
    const clientKey = requestClientKey(request);
    await enforceRateLimit({ scope: "auth.register.ip", key: clientKey, limit: 5, windowMs: 60 * 60_000 });
    await enforceRateLimit({ scope: "auth.register.email", key: body.email, limit: 3, windowMs: 60 * 60_000 });

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
      ipAddress: clientKey,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return apiSuccess(created, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/auth/register");
  }
}
