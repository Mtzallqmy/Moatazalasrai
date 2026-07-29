import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, organizationMembers, organizations, users } from "@/db/schema";
import { bootstrapAuthorized } from "@/lib/auth/api-key";
import { hashPassword } from "@/lib/auth/password";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  if (!bootstrapAuthorized(request)) {
    return apiFailure(401, "UNAUTHORIZED", "رمز التهيئة غير صالح.", requestId);
  }

  try {
    const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
    const password = process.env.OWNER_INITIAL_PASSWORD;
    const name = process.env.OWNER_NAME?.trim() || "معتز العلقمي";
    const organizationName = process.env.OWNER_ORGANIZATION_NAME?.trim() || "Moataz Agent Platform";

    if (!email || !password) {
      throw new ApiError(500, "MISSING_OWNER_ENV", "اضبط OWNER_EMAIL وOWNER_INITIAL_PASSWORD في متغيرات Railway.");
    }

    const existing = await db().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing[0]) {
      throw new ApiError(409, "OWNER_EXISTS", "حساب المالك موجود بالفعل. احذف متغير كلمة المرور الأولية من Railway.");
    }

    const passwordHash = await hashPassword(password);
    const slug = `moataz-${crypto.randomUUID().slice(0, 8)}`;

    const { user, organization } = await db().transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ email, name, passwordHash }).returning({ id: users.id, email: users.email, name: users.name });
      if (!user) throw new Error("OWNER_CREATE_FAILED");
      const [organization] = await tx.insert(organizations).values({ name: organizationName, slug }).returning({ id: organizations.id, name: organizations.name });
      if (!organization) throw new Error("OWNER_ORGANIZATION_CREATE_FAILED");
      await tx.insert(organizationMembers).values({ organizationId: organization.id, userId: user.id, role: "owner" });
      await tx.insert(auditLogs).values({
        organizationId: organization.id,
        actorType: "bootstrap",
        actorId: user.id,
        action: "owner.bootstrapped",
        resourceType: "user",
        resourceId: user.id,
        metadata: { requestId },
      });
      return { user, organization };
    });

    return apiSuccess(
      { user, organization, role: "owner" as const },
      requestId,
      201,
      { securityAction: "احذف OWNER_INITIAL_PASSWORD ودوّر BOOTSTRAP_ADMIN_TOKEN فورًا." },
    );
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/bootstrap-owner");
  }
}
