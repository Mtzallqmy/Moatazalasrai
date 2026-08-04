import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, organizationMembers, organizations, users } from "@/db/schema";
import { withConsumedBootstrapToken } from "@/lib/auth/bootstrap";
import { hashPassword } from "@/lib/auth/password";
import { ApiError, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
    const password = process.env.OWNER_INITIAL_PASSWORD;
    const name = process.env.OWNER_NAME?.trim() || "معتز العلقمي";
    const organizationName = process.env.OWNER_ORGANIZATION_NAME?.trim() || "Moataz Agent Platform";

    if (!email || !password) {
      throw new ApiError(500, "MISSING_OWNER_ENV", "اضبط OWNER_EMAIL وOWNER_INITIAL_PASSWORD في متغيرات التشغيل.");
    }
    const existing = await db().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing[0]) {
      throw new ApiError(409, "OWNER_EXISTS", "حساب المالك موجود بالفعل. احذف متغير كلمة المرور الأولية.");
    }

    const passwordHash = await hashPassword(password);
    const slug = `moataz-${crypto.randomUUID().slice(0, 8)}`;
    const { user, organization } = await withConsumedBootstrapToken({
      request,
      requestId,
      operation: async (tx) => {
        const [user] = await tx.insert(users).values({ email, name, passwordHash }).returning({
          id: users.id,
          email: users.email,
          name: users.name,
        });
        if (!user) throw new Error("OWNER_CREATE_FAILED");
        const [organization] = await tx.insert(organizations).values({ name: organizationName, slug }).returning({
          id: organizations.id,
          name: organizations.name,
        });
        if (!organization) throw new Error("OWNER_ORGANIZATION_CREATE_FAILED");
        await tx.insert(organizationMembers).values({ organizationId: organization.id, userId: user.id, role: "owner" });
        await tx.insert(auditLogs).values([
          {
            organizationId: organization.id,
            actorType: "bootstrap",
            actorId: user.id,
            action: "bootstrap.token.consumed",
            resourceType: "bootstrap_token",
            resourceId: "admin",
            metadata: { requestId, endpoint: "/api/v1/bootstrap-owner" },
          },
          {
            organizationId: organization.id,
            actorType: "bootstrap",
            actorId: user.id,
            action: "owner.bootstrapped",
            resourceType: "user",
            resourceId: user.id,
            metadata: { requestId, mfaEnrollmentRequired: true },
          },
        ]);
        return { user, organization };
      },
    });

    return apiSuccess(
      { user, organization, role: "owner" as const, mfaEnrollmentRequired: true },
      requestId,
      201,
      { securityAction: "فعّل TOTP MFA، احذف OWNER_INITIAL_PASSWORD، ثم شغّل npm run bootstrap:disable." },
    );
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/bootstrap-owner");
  }
}
