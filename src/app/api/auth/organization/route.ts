import { db } from "@/db";
import { auditLogs, organizationMembers, organizations } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { currentSession, setActiveOrganization } from "@/lib/auth/session";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson, ApiError } from "@/lib/http/api";
import { switchOrganizationSchema } from "@/lib/http/contracts";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await currentSession();
    if (!session) throw new ApiError(401, "UNAUTHORIZED", "يجب تسجيل الدخول.");
    const rows = await db()
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(eq(organizationMembers.userId, session.userId))
      .orderBy(asc(organizations.name));
    return apiSuccess({ organizations: rows, activeOrganizationId: session.organizationId }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/auth/organization");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await currentSession();
    if (!session) throw new ApiError(401, "UNAUTHORIZED", "يجب تسجيل الدخول.");
    const body = await parseJson(request, switchOrganizationSchema, 4 * 1024);
    await setActiveOrganization(session.userId, session.sessionId, body.organizationId);
    await db().insert(auditLogs).values({
      organizationId: body.organizationId,
      actorType: "user",
      actorId: session.userId,
      action: "organization.switched",
      resourceType: "organization",
      resourceId: body.organizationId,
      metadata: { requestId },
    });
    return apiSuccess({ activeOrganizationId: body.organizationId }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/auth/organization");
  }
}
