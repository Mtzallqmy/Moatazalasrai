import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { siteMenuItems, siteMenus, sitePageSections, sitePages, siteServices } from "@/db/admin-schema";
import { notificationRules, notificationTemplates } from "@/db/control-plane-schema";

export async function restoreExtendedTrashResource(input: {
  organizationId: string;
  actorUserId: string;
  resourceType: string;
  resourceId: string;
}) {
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
  return true;
}

export async function purgeExtendedTrashResource(input: {
  organizationId: string;
  resourceType: string;
  resourceId: string;
}) {
  if (input.resourceType === "site_page") {
    await db().delete(sitePages).where(and(eq(sitePages.id, input.resourceId), eq(sitePages.organizationId, input.organizationId), eq(sitePages.status, "deleted")));
  } else if (input.resourceType === "site_page_section") {
    await db().delete(sitePageSections).where(and(eq(sitePageSections.id, input.resourceId), eq(sitePageSections.organizationId, input.organizationId), eq(sitePageSections.status, "deleted")));
  } else if (input.resourceType === "site_service") {
    await db().delete(siteServices).where(and(eq(siteServices.id, input.resourceId), eq(siteServices.organizationId, input.organizationId), eq(siteServices.status, "deleted")));
  } else if (input.resourceType === "site_menu") {
    await db().delete(siteMenus).where(and(eq(siteMenus.id, input.resourceId), eq(siteMenus.organizationId, input.organizationId), eq(siteMenus.status, "deleted")));
  } else if (input.resourceType === "site_menu_item") {
    await db().delete(siteMenuItems).where(and(eq(siteMenuItems.id, input.resourceId), eq(siteMenuItems.organizationId, input.organizationId), eq(siteMenuItems.status, "deleted")));
  } else if (input.resourceType === "notification_template") {
    await db().delete(notificationTemplates).where(and(eq(notificationTemplates.id, input.resourceId), eq(notificationTemplates.organizationId, input.organizationId), isNotNull(notificationTemplates.deletedAt)));
  } else if (input.resourceType === "notification_rule") {
    await db().delete(notificationRules).where(and(eq(notificationRules.id, input.resourceId), eq(notificationRules.organizationId, input.organizationId), isNotNull(notificationRules.deletedAt)));
  } else {
    return false;
  }
  return true;
}
