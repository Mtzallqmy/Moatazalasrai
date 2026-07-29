import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, organizationMembers, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { memberMutationSchema, paginationSchema } from "@/lib/http/contracts";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("members:read");
    const query = paginationSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const where = eq(organizationMembers.organizationId, session.organizationId);
    const [rows, totals] = await Promise.all([
      db().select({
        id: organizationMembers.id,
        userId: users.id,
        name: users.name,
        email: users.email,
        role: organizationMembers.role,
        createdAt: organizationMembers.createdAt,
      }).from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(where)
        .orderBy(asc(organizationMembers.createdAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      db().select({ value: count() }).from(organizationMembers).where(where),
    ]);
    const total = totals[0]?.value ?? 0;
    return apiSuccess(rows, requestId, 200, { pagination: { ...query, total, pages: Math.ceil(total / query.limit) } });
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/members");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("members:manage");
    const body = await parseJson(request, memberMutationSchema, 8 * 1024);
    if (body.action === "add") {
      const [user] = await db().select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
      if (!user) throw new ApiError(404, "USER_NOT_FOUND", "لا يوجد حساب مسجل بهذا البريد. لا تتوفر دعوات البريد قبل إعداد مزود بريد.");
      const [existing] = await db().select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(and(
          eq(organizationMembers.organizationId, session.organizationId),
          eq(organizationMembers.userId, user.id),
        ))
        .limit(1);
      if (existing) throw new ApiError(409, "MEMBERSHIP_EXISTS", "المستخدم عضو في المؤسسة بالفعل.");
      const [member] = await db().insert(organizationMembers).values({
        organizationId: session.organizationId,
        userId: user.id,
        role: body.role,
      }).returning();
      await db().insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "member.added",
        resourceType: "organization_member",
        resourceId: member.id,
        metadata: { role: body.role, requestId },
      });
      return apiSuccess(member, requestId, 201);
    }

    const [target] = await db().select().from(organizationMembers).where(and(
      eq(organizationMembers.id, body.memberId),
      eq(organizationMembers.organizationId, session.organizationId),
    )).limit(1);
    if (!target) throw new ApiError(404, "MEMBER_NOT_FOUND", "العضو غير موجود.");
    if (target.role === "owner" && session.role !== "owner") {
      throw new ApiError(403, "OWNER_REQUIRED", "لا يمكن تعديل المالك إلا بواسطة مالك المؤسسة.");
    }
    if (body.action === "remove") {
      if (target.role === "owner") throw new ApiError(409, "OWNER_CANNOT_BE_REMOVED", "لا يمكن إزالة مالك المؤسسة.");
      if (session.role === "admin" && target.role === "admin") throw new ApiError(403, "OWNER_REQUIRED", "إزالة مدير آخر تتطلب صلاحية المالك.");
      await db().delete(organizationMembers).where(and(
        eq(organizationMembers.id, target.id),
        eq(organizationMembers.organizationId, session.organizationId),
      ));
      await db().insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "member.removed",
        resourceType: "organization_member",
        resourceId: target.id,
        metadata: { requestId },
      });
      return apiSuccess({ removed: true, id: target.id }, requestId);
    }

    if (body.role === "owner") throw new ApiError(409, "OWNERSHIP_TRANSFER_UNAVAILABLE", "نقل الملكية غير متاح في هذه النسخة.");
    if (target.role === "owner") throw new ApiError(409, "OWNER_ROLE_LOCKED", "لا يمكن خفض صلاحية المالك.");
    if (session.role === "admin" && (target.role === "admin" || body.role === "admin")) {
      throw new ApiError(403, "OWNER_REQUIRED", "تعديل صلاحيات المديرين يتطلب صلاحية المالك.");
    }
    const [updated] = await db().update(organizationMembers).set({
      role: body.role,
      updatedAt: new Date(),
    }).where(and(
      eq(organizationMembers.id, target.id),
      eq(organizationMembers.organizationId, session.organizationId),
    )).returning();
    await db().insert(auditLogs).values({
      organizationId: session.organizationId,
      actorType: "user",
      actorId: session.userId,
      action: "member.role_updated",
      resourceType: "organization_member",
      resourceId: target.id,
      metadata: { from: target.role, to: body.role, requestId },
    });
    return apiSuccess(updated, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/members");
  }
}
