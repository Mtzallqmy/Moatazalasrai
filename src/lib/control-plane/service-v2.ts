import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { deletedItems } from "@/db/control-plane-schema";
import { auditLogs } from "@/db/schema";
import type { AnyControlPlaneOperation, ControlPlaneOperation } from "@/lib/control-plane/contracts";
import { executeExtendedControlPlaneOperation, isExtendedControlPlaneOperation } from "@/lib/control-plane/extended-service";
import { executeControlPlaneOperation, loadControlPlane } from "@/lib/control-plane/service";
import { purgeExtendedTrashResource, restoreExtendedTrashResource } from "@/lib/control-plane/trash-resources";
import { ApiError } from "@/lib/http/api";

export async function loadControlPlaneV2(organizationId: string) {
  const data = await loadControlPlane(organizationId);
  return {
    ...data,
    rules: data.rules.filter((rule) => !rule.deletedAt),
  };
}

async function extendedTrash(input: {
  organizationId: string;
  actorUserId: string;
  operation: Extract<AnyControlPlaneOperation, { operation: "trash.restore" | "trash.purge" }>;
}) {
  const [item] = await db().select().from(deletedItems).where(and(
    eq(deletedItems.id, input.operation.id),
    eq(deletedItems.organizationId, input.organizationId),
    isNull(deletedItems.restoredAt),
    isNull(deletedItems.permanentlyDeletedAt),
  )).limit(1);
  if (!item) throw new ApiError(404, "TRASH_ITEM_NOT_FOUND", "العنصر المحذوف غير موجود.");

  const handled = input.operation.operation === "trash.restore"
    ? await restoreExtendedTrashResource({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      resourceType: item.resourceType,
      resourceId: item.resourceId,
    })
    : await purgeExtendedTrashResource({
      organizationId: input.organizationId,
      resourceType: item.resourceType,
      resourceId: item.resourceId,
    });
  if (!handled) return null;

  const now = new Date();
  const [updated] = input.operation.operation === "trash.restore"
    ? await db().update(deletedItems).set({ restoredAt: now, restoredByUserId: input.actorUserId }).where(eq(deletedItems.id, item.id)).returning()
    : await db().update(deletedItems).set({ permanentlyDeletedAt: now, permanentlyDeletedByUserId: input.actorUserId }).where(eq(deletedItems.id, item.id)).returning();
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.actorUserId,
    action: input.operation.operation === "trash.restore" ? "trash.item.restored" : "trash.item.purged",
    resourceType: item.resourceType,
    resourceId: item.resourceId,
    metadata: { old: item, new: updated ?? null },
  });
  return updated;
}

export async function executeControlPlaneOperationV2(input: {
  organizationId: string;
  actorUserId: string;
  operation: AnyControlPlaneOperation;
}) {
  if (isExtendedControlPlaneOperation(input.operation)) {
    return executeExtendedControlPlaneOperation({ ...input, operation: input.operation });
  }
  if (input.operation.operation === "trash.restore" || input.operation.operation === "trash.purge") {
    const result = await extendedTrash({ ...input, operation: input.operation });
    if (result) return result;
  }
  return executeControlPlaneOperation({
    ...input,
    operation: input.operation as ControlPlaneOperation,
  });
}
