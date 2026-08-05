import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { siteMenuItems, siteMenus, sitePageSections, sitePages, siteServices } from "@/db/admin-schema";
import {
  customRoles,
  deletedItems,
  featureFlags,
  memberCustomRoles,
  notificationRules,
  notificationTemplates,
  platformModules,
} from "@/db/control-plane-schema";
import { auditLogs, organizationMembers } from "@/db/schema";
import type { ControlPlaneOperation } from "@/lib/control-plane/contracts";
import { ApiError } from "@/lib/http/api";

type ExtendedOperation = Extract<ControlPlaneOperation,
  { operation: "module.create" | "feature.upsert" | "role.unassign" | "template.delete" | "template.restore" | "rule.delete" | "rule.restore" }
>;

const extendedNames = new Set<ControlPlaneOperation["operation"]>([
  "module.create", "feature.upsert", "role.unassign",
  "template.delete", "template.restore", "rule.delete", "rule.restore",
]);

export function isExtendedControlPlaneOperation(value: ControlPlaneOperation): value is ExtendedOperation {
  return extendedNames.has(value.operation);
}

function json(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

async function one<T>(rows: T[], code: string) {
  const value = rows[0];
  if (!value) throw new ApiError(404, code, "العنصر غير موجود داخل المؤسسة الحالية.");
  return value;
}

async function audit(input: {
  organizationId: string; actorUserId: string; action: string;
  resourceType: string; resourceId: string; oldValue?: unknown; newValue?: unknown;
}) {
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.actorUserId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: { old: input.oldValue ?? null, new: input.newValue ?? null },
  });
}

async function moveToTrash(input: {
  organizationId: string; actorUserId: string; resourceType: string;
  resourceId: string; label: string; snapshot: unknown;
}) {
  const state = {
    label: input.label,
    snapshot: json(input.snapshot),
    deletedByUserId: input.actorUserId,
    deletedAt: new Date(),
    restorableUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    restoredByUserId: null,
    restoredAt: null,
    permanentlyDeletedByUserId: null,
    permanentlyDeletedAt: null,
  };
  await db().insert(deletedItems).values({
    organizationId: input.organizationId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    ...state,
  }).onConflictDoUpdate({
    target: [deletedItems.organizationId, deletedItems.resourceType, deletedItems.resourceId],
    set: state,
  });
}

async function markRestored(input: {
  organizationId: string; actorUserId: string; resourceType: string; resourceId: string;
}) {
  await db().update(deletedItems).set({
    restoredByUserId: input.actorUserId,
    restoredAt: new Date(),
  }).where(and(
    eq(deletedItems.organizationId, input.organizationId),
    eq(deletedItems.resourceType, input.resourceType),
    eq(deletedItems.resourceId, input.resourceId),
    isNull(deletedItems.permanentlyDeletedAt),
  ));
}

export async function executeExtendedControlPlaneOperation(input: {
  organizationId: string; actorUserId: string; operation: ExtendedOperation;
}) {
  const op = input.operation;

  if (op.operation === "module.create") {
    const [saved] = await db().insert(platformModules).values({
      organizationId: input.organizationId,
      key: op.key,
      name: op.name,
      description: op.description,
      status: op.status,
      position: op.position,
      config: op.config,
    }).returning();
    if (!saved) throw new Error("MODULE_CREATE_FAILED");
    await audit({ ...input, action: "platform.module.created", resourceType: "platform_module", resourceId: saved.id, newValue: saved });
    return saved;
  }

  if (op.operation === "feature.upsert") {
    const current = op.id
      ? await one(await db().select().from(featureFlags).where(and(eq(featureFlags.id, op.id), eq(featureFlags.organizationId, input.organizationId))).limit(1), "FEATURE_NOT_FOUND")
      : null;
    const values = {
      key: op.key, name: op.name, description: op.description ?? null,
      enabled: op.enabled, rolloutPercentage: op.rolloutPercentage,
      config: op.config, updatedByUserId: input.actorUserId, updatedAt: new Date(),
    };
    const [saved] = current
      ? await db().update(featureFlags).set(values).where(eq(featureFlags.id, current.id)).returning()
      : await db().insert(featureFlags).values({ organizationId: input.organizationId, ...values }).returning();
    if (!saved) throw new Error("FEATURE_SAVE_FAILED");
    await audit({ ...input, action: current ? "platform.feature.updated" : "platform.feature.created", resourceType: "feature_flag", resourceId: saved.id, oldValue: current, newValue: saved });
    return saved;
  }

  if (op.operation === "role.unassign") {
    const member = await one(await db().select().from(organizationMembers).where(and(
      eq(organizationMembers.id, op.organizationMemberId),
      eq(organizationMembers.organizationId, input.organizationId),
    )).limit(1), "MEMBER_NOT_FOUND");
    await one(await db().select().from(customRoles).where(and(
      eq(customRoles.id, op.roleId), eq(customRoles.organizationId, input.organizationId),
    )).limit(1), "CUSTOM_ROLE_NOT_FOUND");
    const removed = await db().delete(memberCustomRoles).where(and(
      eq(memberCustomRoles.organizationId, input.organizationId),
      eq(memberCustomRoles.organizationMemberId, member.id),
      eq(memberCustomRoles.roleId, op.roleId),
    )).returning();
    await audit({ ...input, action: "platform.role.unassigned", resourceType: "organization_member", resourceId: member.id, oldValue: { roleId: op.roleId }, newValue: null });
    return { removed: removed.length > 0, organizationMemberId: member.id, roleId: op.roleId };
  }

  if (op.operation === "template.delete" || op.operation === "template.restore") {
    const current = await one(await db().select().from(notificationTemplates).where(and(
      eq(notificationTemplates.id, op.id), eq(notificationTemplates.organizationId, input.organizationId),
    )).limit(1), "TEMPLATE_NOT_FOUND");
    const restore = op.operation === "template.restore";
    const [saved] = await db().update(notificationTemplates).set({
      enabled: restore,
      deletedAt: restore ? null : new Date(),
      deletedByUserId: restore ? null : input.actorUserId,
      updatedAt: new Date(),
    }).where(eq(notificationTemplates.id, current.id)).returning();
    if (!saved) throw new Error("TEMPLATE_SAVE_FAILED");
    if (restore) await markRestored({ ...input, resourceType: "notification_template", resourceId: current.id });
    else {
      await db().update(notificationRules).set({ enabled: false, updatedAt: new Date() }).where(and(
        eq(notificationRules.organizationId, input.organizationId), eq(notificationRules.templateId, current.id),
      ));
      await moveToTrash({ ...input, resourceType: "notification_template", resourceId: current.id, label: current.name, snapshot: current });
    }
    await audit({ ...input, action: restore ? "notifications.template.restored" : "notifications.template.deleted", resourceType: "notification_template", resourceId: current.id, oldValue: current, newValue: saved });
    return saved;
  }

  const current = await one(await db().select().from(notificationRules).where(and(
    eq(notificationRules.id, op.id), eq(notificationRules.organizationId, input.organizationId),
  )).limit(1), "RULE_NOT_FOUND");
  const restore = op.operation === "rule.restore";
  const [saved] = await db().update(notificationRules).set({
    enabled: restore,
    deletedAt: restore ? null : new Date(),
    deletedByUserId: restore ? null : input.actorUserId,
    updatedAt: new Date(),
  }).where(eq(notificationRules.id, current.id)).returning();
  if (!saved) throw new Error("RULE_SAVE_FAILED");
  if (restore) await markRestored({ ...input, resourceType: "notification_rule", resourceId: current.id });
  else await moveToTrash({ ...input, resourceType: "notification_rule", resourceId: current.id, label: current.name, snapshot: current });
  await audit({ ...input, action: restore ? "notifications.rule.restored" : "notifications.rule.deleted", resourceType: "notification_rule", resourceId: current.id, oldValue: current, newValue: saved });
  return saved;
}

export async function restoreExtendedTrashResource(input: {
  organizationId: string; actorUserId: string; resourceType: string; resourceId: string;
}) {
  if (input.resourceType === "site_page") await db().update(sitePages).set({ status: "draft", deletedAt: null, deletedByUserId: null, updatedByUserId: input.actorUserId, updatedAt: new Date() }).where(and(eq(sitePages.id, input.resourceId), eq(sitePages.organizationId, input.organizationId)));
  else if (input.resourceType === "site_page_section") await db().update(sitePageSections).set({ status: "active", deletedAt: null, deletedByUserId: null, updatedByUserId: input.actorUserId, updatedAt: new Date() }).where(and(eq(sitePageSections.id, input.resourceId), eq(sitePageSections.organizationId, input.organizationId)));
  else if (input.resourceType === "site_service") await db().update(siteServices).set({ status: "active", deletedAt: null, deletedByUserId: null, updatedByUserId: input.actorUserId, updatedAt: new Date() }).where(and(eq(siteServices.id, input.resourceId), eq(siteServices.organizationId, input.organizationId)));
  else if (input.resourceType === "site_menu") await db().update(siteMenus).set({ status: "active", deletedAt: null, deletedByUserId: null, updatedByUserId: input.actorUserId, updatedAt: new Date() }).where(and(eq(siteMenus.id, input.resourceId), eq(siteMenus.organizationId, input.organizationId)));
  else if (input.resourceType === "site_menu_item") await db().update(siteMenuItems).set({ status: "active", deletedAt: null, deletedByUserId: null, updatedByUserId: input.actorUserId, updatedAt: new Date() }).where(and(eq(siteMenuItems.id, input.resourceId), eq(siteMenuItems.organizationId, input.organizationId)));
  else if (input.resourceType === "notification_template") await db().update(notificationTemplates).set({ enabled: true, deletedAt: null, deletedByUserId: null, updatedAt: new Date() }).where(and(eq(notificationTemplates.id, input.resourceId), eq(notificationTemplates.organizationId, input.organizationId)));
  else if (input.resourceType === "notification_rule") await db().update(notificationRules).set({ enabled: true, deletedAt: null, deletedByUserId: null, updatedAt: new Date() }).where(and(eq(notificationRules.id, input.resourceId), eq(notificationRules.organizationId, input.organizationId)));
  else return false;
  return true;
}

export async function purgeExtendedTrashResource(input: {
  organizationId: string; resourceType: string; resourceId: string;
}) {
  if (input.resourceType === "site_page") await db().delete(sitePages).where(and(eq(sitePages.id, input.resourceId), eq(sitePages.organizationId, input.organizationId), eq(sitePages.status, "deleted")));
  else if (input.resourceType === "site_page_section") await db().delete(sitePageSections).where(and(eq(sitePageSections.id, input.resourceId), eq(sitePageSections.organizationId, input.organizationId), eq(sitePageSections.status, "deleted")));
  else if (input.resourceType === "site_service") await db().delete(siteServices).where(and(eq(siteServices.id, input.resourceId), eq(siteServices.organizationId, input.organizationId), eq(siteServices.status, "deleted")));
  else if (input.resourceType === "site_menu") await db().delete(siteMenus).where(and(eq(siteMenus.id, input.resourceId), eq(siteMenus.organizationId, input.organizationId), eq(siteMenus.status, "deleted")));
  else if (input.resourceType === "site_menu_item") await db().delete(siteMenuItems).where(and(eq(siteMenuItems.id, input.resourceId), eq(siteMenuItems.organizationId, input.organizationId), eq(siteMenuItems.status, "deleted")));
  else if (input.resourceType === "notification_template") await db().delete(notificationTemplates).where(and(eq(notificationTemplates.id, input.resourceId), eq(notificationTemplates.organizationId, input.organizationId), isNotNull(notificationTemplates.deletedAt)));
  else if (input.resourceType === "notification_rule") await db().delete(notificationRules).where(and(eq(notificationRules.id, input.resourceId), eq(notificationRules.organizationId, input.organizationId), isNotNull(notificationRules.deletedAt)));
  else return false;
  return true;
}
