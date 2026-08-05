import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
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
import type { AnyControlPlaneOperation, ExtendedControlPlaneOperation } from "@/lib/control-plane/contracts";
import { ApiError } from "@/lib/http/api";

const names = new Set<AnyControlPlaneOperation["operation"]>([
  "module.create", "feature.upsert", "role.unassign",
  "template.delete", "template.restore", "rule.delete", "rule.restore",
]);

export function isExtendedControlPlaneOperation(value: AnyControlPlaneOperation): value is ExtendedControlPlaneOperation {
  return names.has(value.operation);
}

function copy(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

async function required<T>(rows: T[], code: string) {
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
  snapshot: unknown;
}) {
  const values = {
    label: input.label,
    snapshot: copy(input.snapshot),
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
    ...values,
  }).onConflictDoUpdate({
    target: [deletedItems.organizationId, deletedItems.resourceType, deletedItems.resourceId],
    set: values,
  });
}

async function restored(input: {
  organizationId: string;
  actorUserId: string;
  resourceType: string;
  resourceId: string;
}) {
  await db().update(deletedItems).set({ restoredAt: new Date(), restoredByUserId: input.actorUserId }).where(and(
    eq(deletedItems.organizationId, input.organizationId),
    eq(deletedItems.resourceType, input.resourceType),
    eq(deletedItems.resourceId, input.resourceId),
    isNull(deletedItems.permanentlyDeletedAt),
  ));
}

export async function executeExtendedControlPlaneOperation(input: {
  organizationId: string;
  actorUserId: string;
  operation: ExtendedControlPlaneOperation;
}) {
  const op = input.operation;
  if (op.operation === "module.create") {
    const [saved] = await db().insert(platformModules).values({ organizationId: input.organizationId, key: op.key, name: op.name, description: op.description, status: op.status, position: op.position, config: op.config }).returning();
    if (!saved) throw new Error("MODULE_CREATE_FAILED");
    await audit({ ...input, action: "platform.module.created", resourceType: "platform_module", resourceId: saved.id, newValue: saved });
    return saved;
  }

  if (op.operation === "feature.upsert") {
    const current = op.id ? await required(await db().select().from(featureFlags).where(and(eq(featureFlags.id, op.id), eq(featureFlags.organizationId, input.organizationId))).limit(1), "FEATURE_NOT_FOUND") : null;
    const values = { key: op.key, name: op.name, description: op.description ?? null, enabled: op.enabled, rolloutPercentage: op.rolloutPercentage, config: op.config, updatedByUserId: input.actorUserId, updatedAt: new Date() };
    const [saved] = current ? await db().update(featureFlags).set(values).where(eq(featureFlags.id, current.id)).returning() : await db().insert(featureFlags).values({ organizationId: input.organizationId, ...values }).returning();
    if (!saved) throw new Error("FEATURE_SAVE_FAILED");
    await audit({ ...input, action: current ? "platform.feature.updated" : "platform.feature.created", resourceType: "feature_flag", resourceId: saved.id, oldValue: current, newValue: saved });
    return saved;
  }

  if (op.operation === "role.unassign") {
    const member = await required(await db().select().from(organizationMembers).where(and(eq(organizationMembers.id, op.organizationMemberId), eq(organizationMembers.organizationId, input.organizationId))).limit(1), "MEMBER_NOT_FOUND");
    await required(await db().select().from(customRoles).where(and(eq(customRoles.id, op.roleId), eq(customRoles.organizationId, input.organizationId))).limit(1), "CUSTOM_ROLE_NOT_FOUND");
    const removed = await db().delete(memberCustomRoles).where(and(eq(memberCustomRoles.organizationId, input.organizationId), eq(memberCustomRoles.organizationMemberId, member.id), eq(memberCustomRoles.roleId, op.roleId))).returning();
    await audit({ ...input, action: "platform.role.unassigned", resourceType: "organization_member", resourceId: member.id, oldValue: { roleId: op.roleId }, newValue: null });
    return { removed: removed.length > 0, organizationMemberId: member.id, roleId: op.roleId };
  }

  if (op.operation === "template.delete" || op.operation === "template.restore") {
    const current = await required(await db().select().from(notificationTemplates).where(and(eq(notificationTemplates.id, op.id), eq(notificationTemplates.organizationId, input.organizationId))).limit(1), "TEMPLATE_NOT_FOUND");
    const restore = op.operation === "template.restore";
    const [saved] = await db().update(notificationTemplates).set({ enabled: restore, deletedAt: restore ? null : new Date(), deletedByUserId: restore ? null : input.actorUserId, updatedAt: new Date() }).where(eq(notificationTemplates.id, current.id)).returning();
    if (!saved) throw new Error("TEMPLATE_SAVE_FAILED");
    if (restore) await restored({ ...input, resourceType: "notification_template", resourceId: current.id });
    else {
      await db().update(notificationRules).set({ enabled: false, updatedAt: new Date() }).where(and(eq(notificationRules.organizationId, input.organizationId), eq(notificationRules.templateId, current.id)));
      await trash({ ...input, resourceType: "notification_template", resourceId: current.id, label: current.name, snapshot: current });
    }
    await audit({ ...input, action: restore ? "notifications.template.restored" : "notifications.template.deleted", resourceType: "notification_template", resourceId: current.id, oldValue: current, newValue: saved });
    return saved;
  }

  const current = await required(await db().select().from(notificationRules).where(and(eq(notificationRules.id, op.id), eq(notificationRules.organizationId, input.organizationId))).limit(1), "RULE_NOT_FOUND");
  const restore = op.operation === "rule.restore";
  const [saved] = await db().update(notificationRules).set({ enabled: restore, deletedAt: restore ? null : new Date(), deletedByUserId: restore ? null : input.actorUserId, updatedAt: new Date() }).where(eq(notificationRules.id, current.id)).returning();
  if (!saved) throw new Error("RULE_SAVE_FAILED");
  if (restore) await restored({ ...input, resourceType: "notification_rule", resourceId: current.id });
  else await trash({ ...input, resourceType: "notification_rule", resourceId: current.id, label: current.name, snapshot: current });
  await audit({ ...input, action: restore ? "notifications.rule.restored" : "notifications.rule.deleted", resourceType: "notification_rule", resourceId: current.id, oldValue: current, newValue: saved });
  return saved;
}
