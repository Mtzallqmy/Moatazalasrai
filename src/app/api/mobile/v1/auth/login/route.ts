import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { issueMobileSession, mobileOrganizations } from "@/lib/auth/mobile";
import { verifyPassword } from "@/lib/auth/password";
import { apiSuccess, ApiError, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(8).max(200),
  organizationId: z.string().uuid().optional(),
  deviceId: z.string().trim().min(8).max(200),
  deviceName: z.string().trim().min(1).max(200).optional(),
  rememberSession: z.boolean().default(true),
}).strict();

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const body = await parseJson(request, schema, 12 * 1024);
    await enforceRateLimit({ scope: "mobile.login.ip", key: requestClientKey(request), limit: 12, windowMs: 15 * 60_000 });
    await enforceRateLimit({ scope: "mobile.login.email", key: body.email, limit: 8, windowMs: 15 * 60_000 });
    const [user] = await db().select().from(users).where(eq(users.email, body.email)).limit(1);
    if (!user?.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "بيانات الدخول غير صحيحة.");
    }
    const memberships = await mobileOrganizations(user.id);
    if (memberships.length === 0) throw new ApiError(403, "NO_ORGANIZATION", "لا توجد مساحة عمل مرتبطة بهذا الحساب.");
    const selected = body.organizationId
      ? memberships.find((organization) => organization.id === body.organizationId)
      : memberships.length === 1 ? memberships[0] : null;
    if (!selected) {
      return apiSuccess({
        organizationSelectionRequired: true,
        organizations: memberships,
      }, requestId, 409);
    }
    const tokens = await issueMobileSession({
      userId: user.id,
      organizationId: selected.id,
      deviceId: body.deviceId,
      deviceName: body.deviceName,
      rememberSession: body.rememberSession,
    });
    return apiSuccess({
      tokens,
      user: { id: user.id, email: user.email, name: user.name },
      organization: selected,
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/mobile/v1/auth/login");
  }
}
