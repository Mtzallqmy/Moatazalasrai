import { and, asc, count, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, organizationMembers, organizations, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { hashPassword } from "@/lib/auth/password";
import { revokeOrganizationSessions } from "@/lib/auth/membership-access";
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
        expiresAt: organizationMembers.expiresAt,
        customPermissions: organizationMembers.customPermissions,
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
    if (body.action === "registration") {
      if (session.role !== "owner") throw new ApiError(403, "OWNER_REQUIRED", "تغيير التسجيل العام متاح لمالك المؤسسة فقط.");
      if (body.enabled) {
        const [other] = await db().select({ id: organizations.id }).from(organizations).where(and(
          eq(organizations.publicRegistrationEnabled, true),
          ne(organizations.id, session.organizationId),
        )).limit(1);
        if (other) throw new ApiError(409, "PUBLIC_REGISTRATION_ALREADY_ASSIGNED", "التسجيل العام مرتبط بمؤسسة أخرى. أغلقه هناك أولًا.");
      }
      await db().update(organizations).set({
        publicRegistrationEnabled: body.enabled,
        updatedAt: new Date(),
      }).where(eq(organizations.id, session.organizationId));
      await db().insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "organization.public_registration_updated",
        resourceType: "organization",
        resourceId: session.organizationId,
        metadata: { enabled: body.enabled, requestId },
      });
      return apiSuccess({ enabled: body.enabled }, requestId);
    }

    if (body.action === "create") {
      if (session.role === "admin" && body.role === "admin") {
        throw new ApiError(403, "OWNER_REQUIRED", "إنشاء مدير جديد يتطلب صلاحية المالك.");
      }
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      if (expiresAt && expiresAt <= new Date()) {
        throw new ApiError(422, "MEMBERSHIP_EXPIRY_PAST", "يجب أن يكون تاريخ انتهاء الصلاحية في المستقبل.");
      }
      const passwordHash = await hashPassword(body.password);
      const created = await db().transaction(async (tx) => {
        let [user] = await tx.select({ id: users.id, name: users.name, email: users.email })
          .from(users).where(eq(users.email, body.email)).limit(1);
        let userCreated = false;
        if (!user) {
          [user] = await tx.insert(users).values({
            email: body.email,
            name: body.name,
            passwordHash,
          }).onConflictDoNothing().returning({ id: users.id, name: users.name, email: users.email });
          if (!user) {
            [user] = await tx.select({ id: users.id, name: users.name, email: users.email })
              .from(users).where(eq(users.email, body.email)).limit(1);
          } else {
            userCreated = true;
          }
        }
        if (!user) throw new Error("USER_CREATE_FAILED");
        const [existing] = await tx.select({ id: organizationMembers.id }).from(organizationMembers).where(and(
          eq(organizationMembers.organizationId, session.organizationId),
          eq(organizationMembers.userId, user.id),
        )).limit(1);
        if (existing) throw new ApiError(409, "MEMBERSHIP_EXISTS", "المستخدم عضو في المؤسسة بالفعل.");
        const [member] = await tx.insert(organizationMembers).values({
          organizationId: session.organizationId,
          userId: user.id,
          role: body.role,
          expiresAt,
          customPermissions: body.permissions,
        }).returning();
        await tx.insert(auditLogs).values({
          organizationId: session.organizationId,
          actorType: "user",
          actorId: session.userId,
          action: userCreated ? "member.account_created" : "member.existing_account_added",
          resourceType: "organization_member",
          resourceId: member.id,
          metadata: { role: body.role, expiresAt: body.expiresAt, permissions: body.permissions, requestId },
        });
        return { ...member, name: user.name, email: user.email, userCreated };
      });
      return apiSuccess(created, requestId, 201);
    }

    if (body.action === "add") {
      if (session.role === "admin" && body.role === "admin") {
        throw new ApiError(403, "OWNER_REQUIRED", "إضافة مدير جديد تتطلب صلاحية المالك.");
      }
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
      await revokeOrganizationSessions(target.userId, session.organizationId);
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

    if (body.action === "access") {
      if (target.role === "owner") throw new ApiError(409, "OWNER_ROLE_LOCKED", "لا يمكن تعديل صلاحية المالك أو مدتها.");
      if (session.role === "admin" && (target.role === "admin" || body.role === "admin")) {
        throw new ApiError(403, "OWNER_REQUIRED", "تعديل وصول المديرين يتطلب صلاحية المالك.");
      }
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      if (expiresAt && expiresAt <= new Date()) {
        throw new ApiError(422, "MEMBERSHIP_EXPIRY_PAST", "يجب أن يكون تاريخ انتهاء الصلاحية في المستقبل.");
      }
      const [updated] = await db().update(organizationMembers).set({
        role: body.role,
        expiresAt,
        customPermissions: body.permissions,
        updatedAt: new Date(),
      }).where(and(
        eq(organizationMembers.id, target.id),
        eq(organizationMembers.organizationId, session.organizationId),
      )).returning();
      await revokeOrganizationSessions(target.userId, session.organizationId);
      await db().insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "member.access_updated",
        resourceType: "organization_member",
        resourceId: target.id,
        metadata: {
          fromRole: target.role,
          toRole: body.role,
          expiresAt: body.expiresAt,
          permissions: body.permissions,
          requestId,
        },
      });
      return apiSuccess(updated, requestId);
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
    await revokeOrganizationSessions(target.userId, session.organizationId);
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
