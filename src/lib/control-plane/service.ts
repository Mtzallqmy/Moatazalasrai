import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  customRolePermissions,
  customRoles,
  deletedItems,
  featureFlags,
  memberCustomRoles,
  notificationDeliveries,
  notificationRules,
  notificationTemplates,
  platformModules,
  platformSettings,
} from "@/db/control-plane-schema";
import { attachments, auditLogs, conversations, organizationMembers, providerCredentials, users } from "@/db/schema";
import type { ControlPlaneOperation } from "@/lib/control-plane/contracts";
import { ApiError } from "@/lib/http/api";
import { templateVariables } from "@/lib/notifications/render";

async function writeAudit(input: {
  organizationId: string;
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}) {
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.actorUserId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    metadata: { old: input.oldValue ?? null, new: input.newValue ?? null },
  });
}

export async function loadControlPlane(organizationId: string) {
  const [modules, features, settings, roles, rolePermissions, assignments, members, templates, rules, trash, deliveries] = await Promise.all([
    db().select().from(platformModules).where(eq(platformModules.organizationId, organizationId)).orderBy(asc(platformModules.position), asc(platformModules.name)),
    db().select().from(featureFlags).where(eq(featureFlags.organizationId, organizationId)).orderBy(asc(featureFlags.name)),
    db().select().from(platformSettings).where(eq(platformSettings.organizationId, organizationId)).orderBy(asc(platformSettings.namespace), asc(platformSettings.key)),
    db().select().from(customRoles).where(and(eq(customRoles.organizationId, organizationId), isNull(customRoles.deletedAt))).orderBy(asc(customRoles.name)),
    db().select().from(customRolePermissions).where(eq(customRolePermissions.organizationId, organizationId)).orderBy(asc(customRolePermissions.permission)),
    db().select().from(memberCustomRoles).where(eq(memberCustomRoles.organizationId, organizationId)),
    db().select({
      id: organizationMembers.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      baseRole: organizationMembers.role,
    }).from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, organizationId))
      .orderBy(asc(users.name), asc(users.email)),
    db().select().from(notificationTemplates).where(and(
      eq(notificationTemplates.organizationId, organizationId),
      isNull(notificationTemplates.deletedAt),
    )).orderBy(asc(notificationTemplates.name)),
    db().select().from(notificationRules).where(eq(notificationRules.organizationId, organizationId)).orderBy(asc(notificationRules.priority), asc(notificationRules.name)),
    db().select().from(deletedItems).where(and(
      eq(deletedItems.organizationId, organizationId),
      isNull(deletedItems.restoredAt),
      isNull(deletedItems.permanentlyDeletedAt),
    )).orderBy(desc(deletedItems.deletedAt)).limit(200),
    db().select().from(notificationDeliveries).where(eq(notificationDeliveries.organizationId, organizationId)).orderBy(desc(notificationDeliveries.createdAt)).limit(100),
  ]);

  return {
    modules,
    features,
    settings: settings.map((setting) => ({
      ...setting,
      value: setting.sensitive ? { configured: true } : setting.value,
    })),
    roles,
    rolePermissions,
    assignments,
    members,
    templates,
    rules,
    trash,
    deliveries,
  };
}

async function requireOwned<T>(rows: T[], code: string) {
  const row = rows[0];
  if (!row) throw new ApiError(404, code, "العنصر غير موجود داخل المؤسسة الحالية.");
  return row;
}

export async function executeControlPlaneOperation(input: {
  organizationId: string;
  actorUserId: string;
  operation: ControlPlaneOperation;
}) {
  const op = input.operation;

  if (op.operation === "module.update") {
    const current = await requireOwned(await db().select().from(platformModules).where(and(
      eq(platformModules.id, op.id),
      eq(platformModules.organizationId, input.organizationId),
    )).limit(1), "MODULE_NOT_FOUND");
    const nextStatus = op.status ?? current.status;
    const [updated] = await db().update(platformModules).set({
      ...(op.name !== undefined ? { name: op.name } : {}),
      ...(op.status !== undefined ? { status: op.status } : {}),
      ...(op.position !== undefined ? { position: op.position } : {}),
      ...(op.config !== undefined ? { config: op.config } : {}),
      deletedAt: nextStatus === "deleted" ? current.deletedAt ?? new Date() : null,
      deletedByUserId: nextStatus === "deleted" ? input.actorUserId : null,
      updatedAt: new Date(),
    }).where(eq(platformModules.id, current.id)).returning();

    if (nextStatus === "deleted") {
      await db().insert(deletedItems).values({
        organizationId: input.organizationId,
        resourceType: "platform_module",
        resourceId: current.id,
        label: current.name,
        snapshot: current,
        deletedByUserId: input.actorUserId,
        restorableUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }).onConflictDoUpdate({
        target: [deletedItems.organizationId, deletedItems.resourceType, deletedItems.resourceId],
        set: {
          snapshot: current,
          deletedByUserId: input.actorUserId,
          deletedAt: new Date(),
          restoredAt: null,
          permanentlyDeletedAt: null,
        },
      });
    }

    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "platform.module.updated",
      resourceType: "platform_module",
      resourceId: current.id,
      oldValue: current,
      newValue: updated,
    });
    return updated;
  }

  if (op.operation === "feature.update") {
    const current = await requireOwned(await db().select().from(featureFlags).where(and(
      eq(featureFlags.id, op.id),
      eq(featureFlags.organizationId, input.organizationId),
    )).limit(1), "FEATURE_NOT_FOUND");
    const [updated] = await db().update(featureFlags).set({
      ...(op.enabled !== undefined ? { enabled: op.enabled } : {}),
      ...(op.rolloutPercentage !== undefined ? { rolloutPercentage: op.rolloutPercentage } : {}),
      ...(op.config !== undefined ? { config: op.config } : {}),
      updatedByUserId: input.actorUserId,
      updatedAt: new Date(),
    }).where(eq(featureFlags.id, current.id)).returning();
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "platform.feature.updated",
      resourceType: "feature_flag",
      resourceId: current.id,
      oldValue: current,
      newValue: updated,
    });
    return updated;
  }

  if (op.operation === "setting.upsert") {
    const [current] = await db().select().from(platformSettings).where(and(
      eq(platformSettings.organizationId, input.organizationId),
      eq(platformSettings.namespace, op.namespace),
      eq(platformSettings.key, op.key),
    )).limit(1);
    const [updated] = await db().insert(platformSettings).values({
      organizationId: input.organizationId,
      namespace: op.namespace,
      key: op.key,
      value: op.value,
      sensitive: op.sensitive,
      updatedByUserId: input.actorUserId,
    }).onConflictDoUpdate({
      target: [platformSettings.organizationId, platformSettings.namespace, platformSettings.key],
      set: {
        value: op.value,
        sensitive: op.sensitive,
        updatedByUserId: input.actorUserId,
        updatedAt: new Date(),
      },
    }).returning();
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "platform.setting.updated",
      resourceType: "platform_setting",
      resourceId: updated?.id,
      oldValue: current ? { ...current, value: current.sensitive ? "[REDACTED]" : current.value } : null,
      newValue: updated ? { ...updated, value: updated.sensitive ? "[REDACTED]" : updated.value } : null,
    });
    return updated;
  }

  if (op.operation === "role.upsert") {
    const current = op.id ? await requireOwned(await db().select().from(customRoles).where(and(
      eq(customRoles.id, op.id),
      eq(customRoles.organizationId, input.organizationId),
    )).limit(1), "CUSTOM_ROLE_NOT_FOUND") : null;
    const [role] = current
      ? await db().update(customRoles).set({
        key: op.key,
        name: op.name,
        description: op.description ?? null,
        enabled: op.enabled,
        updatedAt: new Date(),
      }).where(eq(customRoles.id, current.id)).returning()
      : await db().insert(customRoles).values({
        organizationId: input.organizationId,
        key: op.key,
        name: op.name,
        description: op.description,
        enabled: op.enabled,
        createdByUserId: input.actorUserId,
      }).returning();
    if (!role) throw new Error("CUSTOM_ROLE_SAVE_FAILED");
    await db().transaction(async (tx) => {
      await tx.delete(customRolePermissions).where(eq(customRolePermissions.roleId, role.id));
      if (op.permissions.length) {
        await tx.insert(customRolePermissions).values(op.permissions.map((permission) => ({
          organizationId: input.organizationId,
          roleId: role.id,
          permission,
        })));
      }
    });
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: current ? "platform.role.updated" : "platform.role.created",
      resourceType: "custom_role",
      resourceId: role.id,
      oldValue: current,
      newValue: { ...role, permissions: op.permissions },
    });
    return role;
  }

  if (op.operation === "role.assign") {
    const member = await requireOwned(await db().select().from(organizationMembers).where(and(
      eq(organizationMembers.id, op.organizationMemberId),
      eq(organizationMembers.organizationId, input.organizationId),
    )).limit(1), "MEMBER_NOT_FOUND");
    await requireOwned(await db().select().from(customRoles).where(and(
      eq(customRoles.id, op.roleId),
      eq(customRoles.organizationId, input.organizationId),
      eq(customRoles.enabled, true),
      isNull(customRoles.deletedAt),
    )).limit(1), "CUSTOM_ROLE_NOT_FOUND");
    const [assignment] = await db().insert(memberCustomRoles).values({
      organizationId: input.organizationId,
      organizationMemberId: member.id,
      roleId: op.roleId,
      assignedByUserId: input.actorUserId,
    }).onConflictDoNothing().returning();
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "platform.role.assigned",
      resourceType: "organization_member",
      resourceId: member.id,
      newValue: { roleId: op.roleId },
    });
    return assignment ?? { organizationMemberId: member.id, roleId: op.roleId };
  }

  if (op.operation === "template.upsert") {
    const detected = templateVariables(`${op.subject ?? ""}\n${op.body}`);
    const undeclared = detected.filter((variable) => !op.variables.includes(variable));
    if (undeclared.length) {
      throw new ApiError(422, "TEMPLATE_VARIABLES_UNDECLARED", `المتغيرات التالية غير معلنة: ${undeclared.join(", ")}`);
    }
    const current = op.id ? await requireOwned(await db().select().from(notificationTemplates).where(and(
      eq(notificationTemplates.id, op.id),
      eq(notificationTemplates.organizationId, input.organizationId),
    )).limit(1), "TEMPLATE_NOT_FOUND") : null;
    const values = {
      key: op.key,
      name: op.name,
      channel: op.channel,
      eventKey: op.eventKey,
      locale: op.locale,
      subject: op.subject ?? null,
      body: op.body,
      variables: op.variables,
      whatsappTemplateName: op.whatsappTemplateName ?? null,
      whatsappTemplateStatus: op.whatsappTemplateStatus,
      enabled: op.enabled,
      updatedAt: new Date(),
    };
    const [template] = current
      ? await db().update(notificationTemplates).set(values).where(eq(notificationTemplates.id, current.id)).returning()
      : await db().insert(notificationTemplates).values({
        organizationId: input.organizationId,
        createdByUserId: input.actorUserId,
        ...values,
      }).returning();
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: current ? "notifications.template.updated" : "notifications.template.created",
      resourceType: "notification_template",
      resourceId: template?.id,
      oldValue: current,
      newValue: template,
    });
    return template;
  }

  if (op.operation === "rule.upsert") {
    await requireOwned(await db().select().from(notificationTemplates).where(and(
      eq(notificationTemplates.id, op.templateId),
      eq(notificationTemplates.organizationId, input.organizationId),
    )).limit(1), "TEMPLATE_NOT_FOUND");
    const current = op.id ? await requireOwned(await db().select().from(notificationRules).where(and(
      eq(notificationRules.id, op.id),
      eq(notificationRules.organizationId, input.organizationId),
    )).limit(1), "RULE_NOT_FOUND") : null;
    const values = {
      name: op.name,
      eventKey: op.eventKey,
      channel: op.channel,
      templateId: op.templateId,
      audienceType: op.audienceType,
      audienceConfig: op.audienceConfig,
      priority: op.priority,
      enabled: op.enabled,
      updatedAt: new Date(),
    };
    const [rule] = current
      ? await db().update(notificationRules).set(values).where(eq(notificationRules.id, current.id)).returning()
      : await db().insert(notificationRules).values({
        organizationId: input.organizationId,
        createdByUserId: input.actorUserId,
        ...values,
      }).returning();
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: current ? "notifications.rule.updated" : "notifications.rule.created",
      resourceType: "notification_rule",
      resourceId: rule?.id,
      oldValue: current,
      newValue: rule,
    });
    return rule;
  }

  const trash = await requireOwned(await db().select().from(deletedItems).where(and(
    eq(deletedItems.id, op.id),
    eq(deletedItems.organizationId, input.organizationId),
    isNull(deletedItems.restoredAt),
    isNull(deletedItems.permanentlyDeletedAt),
  )).limit(1), "TRASH_ITEM_NOT_FOUND");

  if (op.operation === "trash.restore") {
    if (trash.resourceType === "platform_module") {
      await db().update(platformModules).set({
        status: "active",
        deletedAt: null,
        deletedByUserId: null,
        updatedAt: new Date(),
      }).where(and(eq(platformModules.id, trash.resourceId), eq(platformModules.organizationId, input.organizationId)));
    } else if (trash.resourceType === "provider_credential") {
      await db().update(providerCredentials).set({ deletedAt: null, updatedAt: new Date() }).where(and(
        eq(providerCredentials.id, trash.resourceId),
        eq(providerCredentials.organizationId, input.organizationId),
      ));
    } else if (trash.resourceType === "conversation") {
      await db().update(conversations).set({ deletedAt: null, updatedAt: new Date() }).where(and(
        eq(conversations.id, trash.resourceId),
        eq(conversations.organizationId, input.organizationId),
      ));
    } else if (trash.resourceType === "attachment") {
      await db().update(attachments).set({ deletedAt: null, updatedAt: new Date() }).where(and(
        eq(attachments.id, trash.resourceId),
        eq(attachments.organizationId, input.organizationId),
      ));
    } else {
      throw new ApiError(422, "RESTORE_HANDLER_MISSING", "لا يوجد معالج استرجاع آمن لهذا النوع.");
    }
    const [restored] = await db().update(deletedItems).set({
      restoredAt: new Date(),
      restoredByUserId: input.actorUserId,
    }).where(eq(deletedItems.id, trash.id)).returning();
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "trash.item.restored",
      resourceType: trash.resourceType,
      resourceId: trash.resourceId,
      oldValue: trash,
      newValue: restored,
    });
    return restored;
  }

  if (trash.resourceType === "platform_module") {
    await db().delete(platformModules).where(and(eq(platformModules.id, trash.resourceId), eq(platformModules.organizationId, input.organizationId)));
  } else if (trash.resourceType === "provider_credential") {
    await db().delete(providerCredentials).where(and(eq(providerCredentials.id, trash.resourceId), eq(providerCredentials.organizationId, input.organizationId)));
  } else if (trash.resourceType === "conversation") {
    await db().delete(conversations).where(and(eq(conversations.id, trash.resourceId), eq(conversations.organizationId, input.organizationId)));
  } else if (trash.resourceType === "attachment") {
    await db().delete(attachments).where(and(eq(attachments.id, trash.resourceId), eq(attachments.organizationId, input.organizationId)));
  } else {
    throw new ApiError(422, "PURGE_HANDLER_MISSING", "لا يوجد معالج حذف نهائي آمن لهذا النوع.");
  }
  const [purged] = await db().update(deletedItems).set({
    permanentlyDeletedAt: new Date(),
    permanentlyDeletedByUserId: input.actorUserId,
  }).where(eq(deletedItems.id, trash.id)).returning();
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "trash.item.purged",
    resourceType: trash.resourceType,
    resourceId: trash.resourceId,
    oldValue: trash,
    newValue: purged,
  });
  return purged;
}
