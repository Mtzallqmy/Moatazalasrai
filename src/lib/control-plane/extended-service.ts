import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  siteMenuItems,
  siteMenus,
  sitePageSections,
  sitePages,
  siteServices,
} from "@/db/admin-schema";
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
  | { operation: "module.create" }
  | { operation: "feature.upsert" }
  | { operation: "role.unassign" }
  | { operation: "template.delete" }
  | { operation: "template.restore" }
  | { operation: "rule.delete" }
  | { operation: "rule.restore" }
>;

function snapshot(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

async function owned<T>(rows: T[], code: string) {
  const row = rows[0];
  if (!row) throw new ApiError(404, code, "العنصر غير موجود داخل المؤسسة الحالية.");
  return row;
}

async function audit(input: {
  organizationId: string;
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  oldValue?: unknown;
  newValue?: unknown;
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

async function trash(input: {
  organizationId: string;
  actorUserId: string;
  resourceType: string;
  resourceId: string;
  label: string;
  value: unknown;
}) {
  await db().insert(deletedItems).values({
    organizationId: input.organizationId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    label: input.label,
    snapshot: snapshot(input.value),
    deletedByUserId: input.actorUserId,
    restorableUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  }).onConflictDoUpdate({
    target: [deletedItems.organizationId, deletedItems.resourceType, deletedItems.resourceId],
    set: {
      label: input.label,
      snapshot: snapshot(input.value),
      deletedByUserId: input.actorUserId,
      deletedAt: new Date(),
      restorableUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      restoredByUserId: null,
      restoredAt: null,
      permanentlyDeletedByUserId: null,
      permanentlyDeletedAt: null,
    },
  });
}

async function restoreTrashMarker(input: {
  organizationId: string;
  resourceType: string;
  resourceId: string;
  actorUserId: string;
}) {
  await db().update(deletedItems).set({
    restoredAt: new Date(),
    restoredByUserId: input.actorUserId,
  }).where(and(
    eq(deletedItems.organizationId, input.organizationId),
    eq(deletedItems.resourceType, input.resourceType),
    eq(deletedItems.resourceId, input.resourceId),
    isNull(deletedItems.permanentlyDeletedAt),
  ));
}

export function isExtendedControlPlaneOperation(operation: ControlPlaneOperation): operation is ExtendedOperation {
  return [
    "module.create",
    "feature.upsert",
    "role.unassign",
    "template.delete",
    "template.restore",
    "rule.delete",
    "rule.restore",
  ].includes(operation.operation);
}

export async function executeExtendedControlPlaneOperation(input: {
  organizationId: string;
  actorUserId: string;
  operation: ExtendedOperation;
}) {
  const op = input.operation;
  if (op.operation === "module.create") {
    const [module] = await db().insert(platformModules).values({
      organizationId: input.organizationId,
      key: op.key,
      name: op.name,
      description: op.description,
      status: op.status,
      position: op.position,
      config: op.config,
    }).returning();
    if (!module) throw new Error("MODULE_CREATE_FAILED");
    await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: "platform.module.created", resourceType: "platform_module", resourceId: module.id, newValue: module });
    return module;
  }

  if (op.operation === "feature.upsert") {
    const current = op.id
      ? await owned(await db().select().from(featureFlags).where(and(eq(featureFlags.id, op.id), eq(featureFlags.organizationId, input.organizationId))).limit(1), "FEATURE_NOT_FOUND")
      : null;
    const values = {
      key: op.key,
      name: op.name,
      description: op.description ?? null,
      enabled: op.enabled,
      rolloutPercentage: op.rolloutPercentage,
      config: op.config,
      updatedByUserId: input.actorUserId,
      updatedAt: new Date(),
    };
    const [feature] = current
      ? await db().update(featureFlags).set(values).where(eq(featureFlags.id, current.id)).returning()
      : await db().insert(featureFlags).values({ organizationId: input.organizationId, ...values }).returning();
    if (!feature) throw new Error("FEATURE_SAVE_FAILED");
    await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: current ? "platform.feature.updated" : "platform.feature.created", resourceType: "feature_flag", resourceId: feature.id, oldValue: current, newValue: feature });
    return feature;
  }

  if (op.operation === "role.unassign") {
    const member = await owned(await db().select().from(organizationMembers).where(and(eq(organizationMembers.id, op.organizationMemberId), eq(organizationMembers.organizationId, input.organizationId))).limit(1), "MEMBER_NOT_FOUND");
    await owned(await db().select().from(customRoles).where(and(eq(customRoles.id, op.roleId), eq(customRoles.organizationId, input.organizationId))).limit(1), "CUSTOM_ROLE_NOT_FOUND");
    const removed = await db().delete(memberCustomRoles).where(and(
      eq(memberCustomRoles.organizationId, input.organizationId),
      eq(memberCustomRoles.organizationMemberId, member.id),
      eq(memberCustomRoles.roleId, op.roleId),
    )).returning();
    await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: "platform.role.unassigned", resourceType: "organization_member", resourceId: member.id, oldValue: { roleId: op.roleId }, newValue: null });
    return { removed: removed.length > 0, organizationMemberId: member.id, roleId: op.roleId };
  }

  if (op.operation === "template.delete" || op.operation === "template.restore") {
    const current = await owned(await db().select().from(notificationTemplates).where(and(eq(notificationTemplates.id, op.id), eq(notificationTemplates.organizationId, input.organizationId))).limit(1), "TEMPLATE_NOT_FOUND");
    const restoring = op.operation === "template.restore";
    const [template] = await db().update(notificationTemplates).set({
      enabled: restoring ? true : false,
      deletedAt: restoring ? null : new Date(),
      deletedByUserId: restoring ? null : input.actorUserId,
      updatedAt: new Date(),
    }).where(eq(notificationTemplates.id, current.id)).returning();
    if (restoring) {
      await restoreTrashMarker({ organizationId: input.organizationId, resourceType: "notification_template", resourceId: current.id, actorUserId: input.actorUserId });
    } else {
      await db().update(notificationRules).set({ enabled: false, updatedAt: new Date() }).where(and(eq(notificationRules.organizationId, input.organizationId), eq(notificationRules.templateId, current.id)));
      await trash({ organizationId: input.organizationId, actorUserId: input.actorUserId, resourceType: "notification_template", resourceId: current.id, label: current.name, value: current });
    }
    await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: restoring ? "notifications.template.restored" : "notifications.template.deleted", resourceType: "notification_template", resourceId: current.id, oldValue: current, newValue: template });
    return template;
  }

  const current = await owned(await db().select().from(notificationRules).where(and(eq(notificationRules.id, op.id), eq(notificationRules.organizationId, input.organizationId))).limit(1), "RULE_NOT_FOUND");
  const restoring = op.operation === "rule.restore";
  const [rule] = await db().update(notificationRules).set({
    enabled: restoring ? true : false,
    deletedAt: restoring ? null : new Date(),
    deletedByUserId: restoring ? null : input.actorUserId,
    updatedAt: new Date(),
  }).where(eq(notificationRules.id, current.id)).returning();
  if (restoring) await restoreTrashMarker({ organizationId: input.organizationId, resourceType: "notification_rule", resourceId: current.id, actorUserId: input.actorUserId });
  else await trash({ organizationId: input.organizationId, actorUserId: input.actorUserId, resourceType: "notification_rule", resourceId: current.id, label: current.name, value: current });
  await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: restoring ? "notifications.rule.restored" : "notifications.rule.deleted", resourceType: "notification_rule", resourceId: current.id, oldValue: current, newValue: rule });
  return rule;
}

export async function restoreExtendedTrashResource(input: {
  organizationId: string;
  actorUserId: string;
  resourceType: string;
  resourceId: string;
}) {
  const whereId = (column: { _?: unknown }) => and(eq(column as never, input.resourceId), eq(({
    site_page: sitePages.organizationId,
    site_page_section: sitePageSections.organizationId,
    site_service: siteServices.organizationId,
    site_menu: siteMenus.organizationId,
    site_menu_item: siteMenuItems.organizationId,
    notification_template: notificationTemplates.organizationId,
    notification_rule: notificationRules.organizationId,
  } as Record<string, never>)[input.resourceType], input.organizationId));

  if (input.resourceType === "site_page") {
    await db().update(sitePages).set({ status: "draft", deletedAt: null, deletedByUserId: null, updatedByUserId: input.actorUserId, updatedAt: new Date() }).where(and(eq(sitePages.id, input.resourceId), eq(sitePages.organizationId, input.organizationId)));
  } else if (input.resourceType === "site_page_section") {
    await db().update(sitePageSections).set({ status: "active", deletedAt: null, deletedByUserId: null, updatedByUserId: input.actorUserId, updatedAt: new Date() }).where(and(eq(sitePageSections.id, input.resourceId), eq(sitePageSections.organizationId, input.organizationId)));
  } else if (input.resourceType === "site_service") {
    await db().update(siteServices).set({ status: "active", deletedAt: null, deletedByUserId: null, updatedByUserId: input.actorUserId, updatedAt: new Date() }).where(and(eq(siteServices.id, input.resourceId), eq(siteServices.organizationId, input.organizationId)));
  } else if (input.resourceType === "site_menu") {
    await db().update(siteMenus).set({ status: "active", deletedAt: null, deletedByUserId: null, updatedByUserId: input.actorUserId, updatedAt: new Date() }).where(and(eq(siteMenus.id, input.resourceId), eq(siteMenus.organizationId, input.organizationId)));
  } else if (input.resourceType === "site_menu_item") {
    await db().update(siteMenuItems).set({ status: "active", deletedAt: null, deletedByUserId: null, updatedByUserId: input.actorUserId, updatedAt: new Date() }).where(and(eq(siteMenuItems.id, input.resourceId), eq(siteMenuItems.organizationId, input.organizationId)));
  } else if (input.resourceType === "notification_template") {
    await db().update(notificationTemplates).set({ enabled: true, deletedAt: null, deletedByUserId: null, updatedAt: new Date() }).where(and(eq(notificationTemplates.id, input.resourceId), eq(notificationTemplates.organizationId, input.organizationId)));
  } else if (input.resourceType === "notification_rule") {
    await db().update(notificationRules).set({ enabled: true, deletedAt: null, deletedByUserId: null, updatedAt: new Date() }).where(and(eq(notificationRules.id, input.resourceId), eq(notificationRules.organizationId, input.organizationId)));
  } else {
    return false;
  }
  void whereId;
  return true;
}

export async function purgeExtendedTrashResource(input: {
  organizationId: string;
  resourceType: string;
  resourceId: string;
}) {
  if (input.resourceType === "site_page") await db().delete(sitePages).where(and(eq(sitePages.id, input.resourceId), eq(sitePages.organizationId, input.organizationId), eq(sitePages.status, "deleted")));
  else if (input.resourceType === "site_page_section") await db().delete(sitePageSections).where(and(eq(sitePageSections.id, input.resourceId), eq(sitePageSections.organizationId, input.organizationId), eq(sitePageSections.status, "deleted")));
  else if (input.resourceType === "site_service") await db().delete(siteServices).where(and(eq(siteServices.id, input.resourceId), eq(siteServices.organizationId, input.organizationId), eq(siteServices.status, "deleted")));
  else if (input.resourceType === "site_menu") await db().delete(siteMenus).where(and(eq(siteMenus.id, input.resourceId), eq(siteMenus.organizationId, input.organizationId), eq(siteMenus.status, "deleted")));
  else if (input.resourceType === "site_menu_item") await db().delete(siteMenuItems).where(and(eq(siteMenuItems.id, input.resourceId), eq(siteMenuItems.organizationId, input.organizationId), eq(siteMenuItems.status, "deleted")));
  else if (input.resourceType === "notification_template") await db().delete(notificationTemplates).where(and(eq(notificationTemplates.id, input.resourceId), eq(notificationTemplates.organizationId, input.organizationId), isNull(notificationTemplates.deletedAt).not()));
  else if (input.resourceType === "notification_rule") await db().delete(notificationRules).where(and(eq(notificationRules.id, input.resourceId), eq(notificationRules.organizationId, input.organizationId), isNull(notificationRules.deletedAt).not()));
  else return false;
  return true;
}
