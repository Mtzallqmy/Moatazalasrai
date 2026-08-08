import type { User } from "@supabase/supabase-js";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, organizationMembers, organizations, sessions, users } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { activeMembership } from "@/lib/auth/membership-access";

export function supabaseSessionIdFromAccessToken(accessToken: string) {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { session_id?: unknown };
    if (typeof payload.session_id === "string" && /^[0-9a-f-]{36}$/i.test(payload.session_id)) return payload.session_id;
  } catch {}
  throw new ApiError(401, "AUTH_SESSION_INVALID", "جلسة المصادقة غير صالحة.");
}

function verifiedEmail(user: User) {
  const email = user.email?.trim().toLowerCase();
  if (!email || !user.email_confirmed_at) {
    throw new ApiError(403, "EMAIL_NOT_VERIFIED", "يجب تأكيد البريد الإلكتروني قبل دخول المنصة.");
  }
  return email;
}

function identityName(user: User, email: string) {
  const candidate = user.user_metadata?.full_name ?? user.user_metadata?.name;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim().slice(0, 100)
    : email.split("@")[0].slice(0, 100);
}

/** Links a server-verified Supabase identity to Railway data without trusting client metadata for authorization. */
export async function ensureLocalIdentity(user: User) {
  const email = verifiedEmail(user);
  const confirmedAt = user.email_confirmed_at!;
  const name = identityName(user, email);
  const officialOwnerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  return db().transaction(async (tx) => {
    const ensureOfficialOwner = async <T extends { id: string; email: string; name: string | null }>(identity: T) => {
      if (!officialOwnerEmail || email !== officialOwnerEmail) return identity;

      const [existingMembership] = await tx.select({
        id: organizationMembers.id,
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
        expiresAt: organizationMembers.expiresAt,
      }).from(organizationMembers)
        .where(eq(organizationMembers.userId, identity.id))
        .orderBy(asc(organizationMembers.createdAt))
        .limit(1);

      let organizationId = existingMembership?.organizationId;
      let changed = false;
      if (existingMembership) {
        if (existingMembership.role !== "owner" || existingMembership.expiresAt) {
          await tx.update(organizationMembers).set({
            role: "owner",
            expiresAt: null,
            updatedAt: new Date(),
          }).where(eq(organizationMembers.id, existingMembership.id));
          changed = true;
        }
      } else {
        const ownerOrganizationName = process.env.OWNER_ORGANIZATION_NAME?.trim() || "Moataz Agent Platform";
        const ownerOrganizationSlug = `moataz-${identity.id.slice(0, 8)}`;
        const [createdOrganization] = await tx.insert(organizations).values({
          name: ownerOrganizationName,
          slug: ownerOrganizationSlug,
        }).onConflictDoNothing({ target: organizations.slug }).returning({ id: organizations.id });
        if (createdOrganization) {
          organizationId = createdOrganization.id;
        } else {
          const [existingOrganization] = await tx.select({ id: organizations.id })
            .from(organizations).where(eq(organizations.slug, ownerOrganizationSlug)).limit(1);
          organizationId = existingOrganization?.id;
        }
        if (!organizationId) throw new Error("OWNER_ORGANIZATION_CREATE_FAILED");
        await tx.insert(organizationMembers).values({
          organizationId,
          userId: identity.id,
          role: "owner",
        }).onConflictDoUpdate({
          target: [organizationMembers.organizationId, organizationMembers.userId],
          set: { role: "owner", expiresAt: null, updatedAt: new Date() },
        });
        changed = true;
      }

      if (changed && organizationId) {
        await tx.insert(auditLogs).values({
          organizationId,
          actorType: "user",
          actorId: identity.id,
          action: "owner.supabase_identity_claimed",
          resourceType: "user",
          resourceId: identity.id,
          metadata: { provider: user.app_metadata?.provider ?? "unknown" },
        });
      }
      return identity;
    };

    const [bySubject] = await tx.select({ id: users.id, email: users.email, name: users.name })
      .from(users).where(eq(users.supabaseUserId, user.id)).limit(1);
    if (bySubject) return ensureOfficialOwner(bySubject);

    const [byEmail] = await tx.select({ id: users.id, email: users.email, name: users.name, supabaseUserId: users.supabaseUserId })
      .from(users).where(eq(users.email, email)).limit(1);
    if (byEmail) {
      if (byEmail.supabaseUserId && byEmail.supabaseUserId !== user.id) {
        throw new ApiError(409, "IDENTITY_ALREADY_LINKED", "البريد مرتبط بهوية مصادقة أخرى.");
      }
      const [linked] = await tx.update(users).set({
        supabaseUserId: user.id,
        authLinkedAt: new Date(),
        emailVerifiedAt: new Date(confirmedAt),
        name: byEmail.name ?? name,
        updatedAt: new Date(),
      }).where(eq(users.id, byEmail.id)).returning({ id: users.id, email: users.email, name: users.name });
      if (!linked) throw new Error("AUTH_IDENTITY_LINK_FAILED");
      return ensureOfficialOwner(linked);
    }

    if (officialOwnerEmail && email === officialOwnerEmail) {
      const [createdOwner] = await tx.insert(users).values({
        email,
        name,
        supabaseUserId: user.id,
        authLinkedAt: new Date(),
        emailVerifiedAt: new Date(confirmedAt),
      }).onConflictDoNothing({ target: users.email }).returning({ id: users.id, email: users.email, name: users.name });
      const ownerIdentity = createdOwner ?? (await tx.select({ id: users.id, email: users.email, name: users.name })
        .from(users).where(eq(users.email, email)).limit(1))[0];
      if (!ownerIdentity) throw new Error("OWNER_USER_CREATE_FAILED");
      return ensureOfficialOwner(ownerIdentity);
    }

    const [registrationOrganization] = await tx.select({ id: organizations.id })
      .from(organizations).where(eq(organizations.publicRegistrationEnabled, true)).limit(1);
    if (!registrationOrganization) {
      throw new ApiError(403, "REGISTRATION_CLOSED", "الحساب موثّق، لكن التسجيل العام غير مفعّل. اطلب من المالك إضافتك.");
    }
    const [created] = await tx.insert(users).values({
      email,
      name,
      supabaseUserId: user.id,
      authLinkedAt: new Date(),
      emailVerifiedAt: new Date(confirmedAt),
    }).returning({ id: users.id, email: users.email, name: users.name });
    if (!created) throw new Error("USER_CREATE_FAILED");
    await tx.insert(organizationMembers).values({
      organizationId: registrationOrganization.id,
      userId: created.id,
      role: "member",
    });
    await tx.insert(auditLogs).values({
      organizationId: registrationOrganization.id,
      actorType: "user",
      actorId: created.id,
      action: "auth.supabase_registered",
      resourceType: "user",
      resourceId: created.id,
      metadata: { provider: user.app_metadata?.provider ?? "unknown" },
    });
    return created;
  });
}

export async function upsertSupabaseAppSession(input: {
  userId: string;
  supabaseSessionId: string;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
}) {
  const memberships = await db().select({ organizationId: organizationMembers.organizationId, expiresAt: organizationMembers.expiresAt })
    .from(organizationMembers).where(and(eq(organizationMembers.userId, input.userId), activeMembership()))
    .orderBy(asc(organizationMembers.createdAt)).limit(2);
  if (memberships.length === 0) throw new ApiError(403, "ACCOUNT_ACCESS_EXPIRED", "انتهت صلاحية الحساب أو لا توجد عضوية نشطة.");
  const activeOrganizationId = memberships.length === 1 ? memberships[0].organizationId : null;
  const expiresAt = input.expiresAt;
  const [record] = await db().insert(sessions).values({
    userId: input.userId,
    supabaseSessionId: input.supabaseSessionId,
    authSource: "supabase",
    activeOrganizationId,
    expiresAt,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent?.slice(0, 500),
  }).onConflictDoUpdate({
    target: sessions.supabaseSessionId,
    set: { expiresAt, revokedAt: null, lastSeenAt: new Date(), ipAddress: input.ipAddress, userAgent: input.userAgent?.slice(0, 500) },
  }).returning({ id: sessions.id, activeOrganizationId: sessions.activeOrganizationId });
  if (!record) throw new Error("APP_SESSION_CREATE_FAILED");
  return { ...record, organizationSelectionRequired: memberships.length !== 1 };
}
