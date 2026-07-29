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

    const passwordHash = await hashPassword(body.password);
    const slugBase = body.organizationName
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "org";
    const slug = `${slugBase}-${crypto.randomUUID().slice(0, 8)}`;

    const created = await db().transaction(async (tx) => {
      const [user] = await tx.insert(users).values({
        email: body.email,
        name: body.name,
        passwordHash,
      }).returning({ id: users.id });
      if (!user) throw new Error("USER_CREATE_FAILED");

      const [organization] = await tx.insert(organizations).values({
        name: body.organizationName,
        slug,
      }).returning({ id: organizations.id });
      if (!organization) throw new Error("ORGANIZATION_CREATE_FAILED");

      await tx.insert(organizationMembers).values({
        organizationId: organization.id,
        userId: user.id,
        role: "owner",
      });
      await tx.insert(auditLogs).values({
        organizationId: organization.id,
        actorType: "user",
        actorId: user.id,
        action: "auth.register",
        resourceType: "user",
        resourceId: user.id,
        metadata: { requestId },
      });
      return { userId: user.id, organizationId: organization.id };
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
