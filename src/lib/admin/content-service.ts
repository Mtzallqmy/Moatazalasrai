import { and, asc, desc, eq, isNull, max } from "drizzle-orm";
import { db } from "@/db";
import {
  contentRevisions,
  siteMenuItems,
  siteMenus,
  sitePageSections,
  sitePages,
  siteServices,
} from "@/db/admin-schema";
import { deletedItems } from "@/db/control-plane-schema";
import { auditLogs, organizations } from "@/db/schema";
import type { ContentOperation } from "@/lib/admin/content-contracts";
import { publishDomainEventBestEffort } from "@/lib/events/publish";
import { ApiError } from "@/lib/http/api";

function plain(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function databaseCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "";
}

async function owned<T>(rows: T[], code: string, message = "العنصر غير موجود داخل المؤسسة الحالية.") {
  const row = rows[0];
  if (!row) throw new ApiError(404, code, message);
  return row;
}

async function revision(input: {
  organizationId: string;
  resourceType: string;
  resourceId: string;
  snapshot: Record<string, unknown>;
  actorUserId: string;
  summary?: string;
}) {
  const [current] = await db().select({ value: max(contentRevisions.version) })
    .from(contentRevisions)
    .where(and(
      eq(contentRevisions.organizationId, input.organizationId),
      eq(contentRevisions.resourceType, input.resourceType),
      eq(contentRevisions.resourceId, input.resourceId),
    ));
  const version = Number(current?.value ?? 0) + 1;
  await db().insert(contentRevisions).values({
    organizationId: input.organizationId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    version,
    snapshot: input.snapshot,
    changeSummary: input.summary,
    createdByUserId: input.actorUserId,
  });
  return version;
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

async function putTrash(input: {
  organizationId: string;
  actorUserId: string;
  resourceType: string;
  resourceId: string;
  label: string;
  snapshot: Record<string, unknown>;
}) {
  await db().insert(deletedItems).values({
    organizationId: input.organizationId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    label: input.label,
    snapshot: input.snapshot,
    deletedByUserId: input.actorUserId,
    restorableUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  }).onConflictDoUpdate({
    target: [deletedItems.organizationId, deletedItems.resourceType, deletedItems.resourceId],
    set: {
      label: input.label,
      snapshot: input.snapshot,
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

async function markRestored(organizationId: string, resourceType: string, resourceId: string, actorUserId: string) {
  await db().update(deletedItems).set({
    restoredAt: new Date(),
    restoredByUserId: actorUserId,
  }).where(and(
    eq(deletedItems.organizationId, organizationId),
    eq(deletedItems.resourceType, resourceType),
    eq(deletedItems.resourceId, resourceId),
  ));
}

export async function loadContentManager(organizationId: string) {
  const [pages, sections, services, menus, menuItems, revisions, trash] = await Promise.all([
    db().select().from(sitePages).where(and(eq(sitePages.organizationId, organizationId), isNull(sitePages.deletedAt)))
      .orderBy(asc(sitePages.position), asc(sitePages.title)),
    db().select().from(sitePageSections).where(and(eq(sitePageSections.organizationId, organizationId), isNull(sitePageSections.deletedAt)))
      .orderBy(asc(sitePageSections.pageId), asc(sitePageSections.position)),
    db().select().from(siteServices).where(and(eq(siteServices.organizationId, organizationId), isNull(siteServices.deletedAt)))
      .orderBy(asc(siteServices.position), asc(siteServices.name)),
    db().select().from(siteMenus).where(and(eq(siteMenus.organizationId, organizationId), isNull(siteMenus.deletedAt)))
      .orderBy(asc(siteMenus.name)),
    db().select().from(siteMenuItems).where(and(eq(siteMenuItems.organizationId, organizationId), isNull(siteMenuItems.deletedAt)))
      .orderBy(asc(siteMenuItems.menuId), asc(siteMenuItems.position)),
    db().select().from(contentRevisions).where(eq(contentRevisions.organizationId, organizationId))
      .orderBy(desc(contentRevisions.createdAt)).limit(100),
    db().select().from(deletedItems).where(and(
      eq(deletedItems.organizationId, organizationId),
      isNull(deletedItems.restoredAt),
      isNull(deletedItems.permanentlyDeletedAt),
    )).orderBy(desc(deletedItems.deletedAt)).limit(200),
  ]);
  return {
    pages,
    sections,
    services,
    menus,
    menuItems,
    revisions,
    trash: trash.filter((item) => ["site_page", "site_page_section", "site_service", "site_menu", "site_menu_item"].includes(item.resourceType)),
  };
}

export async function loadPublicPage(input: { organizationSlug: string; pageSlug: string }) {
  const [page] = await db().select({ page: sitePages, organization: organizations })
    .from(sitePages)
    .innerJoin(organizations, eq(organizations.id, sitePages.organizationId))
    .where(and(
      eq(organizations.slug, input.organizationSlug),
      eq(sitePages.slug, input.pageSlug),
      eq(sitePages.status, "published"),
      isNull(sitePages.deletedAt),
    )).limit(1);
  if (!page) return null;
  const [sections, services] = await Promise.all([
    db().select().from(sitePageSections).where(and(
      eq(sitePageSections.organizationId, page.organization.id),
      eq(sitePageSections.pageId, page.page.id),
      isNull(sitePageSections.deletedAt),
    )).orderBy(asc(sitePageSections.position)),
    db().select().from(siteServices).where(and(
      eq(siteServices.organizationId, page.organization.id),
      eq(siteServices.status, "active"),
      isNull(siteServices.deletedAt),
    )).orderBy(asc(siteServices.position)),
  ]);
  return {
    organization: page.organization,
    page: page.page,
    sections: sections.filter((section) => section.status === "active" || section.status === "published"),
    services,
  };
}

export async function executeContentOperation(input: {
  organizationId: string;
  actorUserId: string;
  operation: ContentOperation;
}) {
  const op = input.operation;
  try {
    if (op.operation === "page.upsert") {
      const current = op.id ? await owned(await db().select().from(sitePages).where(and(
        eq(sitePages.id, op.id),
        eq(sitePages.organizationId, input.organizationId),
      )).limit(1), "PAGE_NOT_FOUND") : null;
      const values = {
        slug: op.slug,
        title: op.title,
        excerpt: op.excerpt ?? null,
        status: op.status,
        template: op.template,
        position: op.position,
        seo: op.seo,
        settings: op.settings,
        updatedByUserId: input.actorUserId,
        publishedAt: op.status === "published" ? current?.publishedAt ?? new Date() : current?.publishedAt ?? null,
        deletedAt: op.status === "deleted" ? current?.deletedAt ?? new Date() : null,
        deletedByUserId: op.status === "deleted" ? input.actorUserId : null,
        updatedAt: new Date(),
      };
      const [page] = current
        ? await db().update(sitePages).set(values).where(eq(sitePages.id, current.id)).returning()
        : await db().insert(sitePages).values({
          organizationId: input.organizationId,
          createdByUserId: input.actorUserId,
          ...values,
        }).returning();
      if (!page) throw new Error("PAGE_SAVE_FAILED");
      await revision({ organizationId: input.organizationId, resourceType: "site_page", resourceId: page.id, snapshot: plain(page), actorUserId: input.actorUserId, summary: op.changeSummary });
      if (op.status === "deleted") await putTrash({ organizationId: input.organizationId, actorUserId: input.actorUserId, resourceType: "site_page", resourceId: page.id, label: page.title, snapshot: plain(current ?? page) });
      await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: current ? "content.page.updated" : "content.page.created", resourceType: "site_page", resourceId: page.id, oldValue: current, newValue: page });
      await publishDomainEventBestEffort({ organizationId: input.organizationId, eventKey: op.status === "published" ? "content.page.published" : "content.page.updated", actorType: "user", actorId: input.actorUserId, resourceType: "site_page", resourceId: page.id, payload: { pageId: page.id, slug: page.slug, title: page.title, status: page.status } });
      return page;
    }

    if (op.operation === "page.delete") {
      const current = await owned(await db().select().from(sitePages).where(and(eq(sitePages.id, op.id), eq(sitePages.organizationId, input.organizationId))).limit(1), "PAGE_NOT_FOUND");
      const [page] = await db().update(sitePages).set({ status: "deleted", deletedAt: new Date(), deletedByUserId: input.actorUserId, updatedByUserId: input.actorUserId, updatedAt: new Date() }).where(eq(sitePages.id, current.id)).returning();
      await putTrash({ organizationId: input.organizationId, actorUserId: input.actorUserId, resourceType: "site_page", resourceId: current.id, label: current.title, snapshot: plain(current) });
      await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: "content.page.deleted", resourceType: "site_page", resourceId: current.id, oldValue: current, newValue: page });
      return page;
    }

    if (op.operation === "page.restore") {
      const current = await owned(await db().select().from(sitePages).where(and(eq(sitePages.id, op.id), eq(sitePages.organizationId, input.organizationId))).limit(1), "PAGE_NOT_FOUND");
      const [page] = await db().update(sitePages).set({ status: "draft", deletedAt: null, deletedByUserId: null, updatedByUserId: input.actorUserId, updatedAt: new Date() }).where(eq(sitePages.id, current.id)).returning();
      await markRestored(input.organizationId, "site_page", current.id, input.actorUserId);
      await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: "content.page.restored", resourceType: "site_page", resourceId: current.id, oldValue: current, newValue: page });
      return page;
    }

    if (op.operation === "page.purge") {
      const current = await owned(await db().select().from(sitePages).where(and(eq(sitePages.id, op.id), eq(sitePages.organizationId, input.organizationId), eq(sitePages.status, "deleted"))).limit(1), "PAGE_NOT_DELETED");
      await db().delete(sitePages).where(eq(sitePages.id, current.id));
      await db().update(deletedItems).set({ permanentlyDeletedAt: new Date(), permanentlyDeletedByUserId: input.actorUserId }).where(and(eq(deletedItems.organizationId, input.organizationId), eq(deletedItems.resourceType, "site_page"), eq(deletedItems.resourceId, current.id)));
      await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: "content.page.purged", resourceType: "site_page", resourceId: current.id, oldValue: current });
      return { id: current.id, purged: true };
    }

    if (op.operation === "section.upsert") {
      await owned(await db().select({ id: sitePages.id }).from(sitePages).where(and(eq(sitePages.id, op.pageId), eq(sitePages.organizationId, input.organizationId), isNull(sitePages.deletedAt))).limit(1), "PAGE_NOT_FOUND");
      const current = op.id ? await owned(await db().select().from(sitePageSections).where(and(eq(sitePageSections.id, op.id), eq(sitePageSections.organizationId, input.organizationId))).limit(1), "SECTION_NOT_FOUND") : null;
      const values = {
        pageId: op.pageId,
        key: op.key,
        type: op.payload.type,
        title: op.title ?? null,
        content: op.payload.content,
        settings: op.settings,
        status: op.status,
        position: op.position,
        updatedByUserId: input.actorUserId,
        deletedAt: op.status === "deleted" ? current?.deletedAt ?? new Date() : null,
        deletedByUserId: op.status === "deleted" ? input.actorUserId : null,
        updatedAt: new Date(),
      };
      const [section] = current
        ? await db().update(sitePageSections).set(values).where(eq(sitePageSections.id, current.id)).returning()
        : await db().insert(sitePageSections).values({ organizationId: input.organizationId, createdByUserId: input.actorUserId, ...values }).returning();
      if (!section) throw new Error("SECTION_SAVE_FAILED");
      await revision({ organizationId: input.organizationId, resourceType: "site_page_section", resourceId: section.id, snapshot: plain(section), actorUserId: input.actorUserId, summary: op.changeSummary });
      if (op.status === "deleted") await putTrash({ organizationId: input.organizationId, actorUserId: input.actorUserId, resourceType: "site_page_section", resourceId: section.id, label: section.title ?? section.key, snapshot: plain(current ?? section) });
      await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: current ? "content.section.updated" : "content.section.created", resourceType: "site_page_section", resourceId: section.id, oldValue: current, newValue: section });
      return section;
    }

    if (op.operation === "section.delete" || op.operation === "section.restore") {
      const current = await owned(await db().select().from(sitePageSections).where(and(eq(sitePageSections.id, op.id), eq(sitePageSections.organizationId, input.organizationId))).limit(1), "SECTION_NOT_FOUND");
      const restoring = op.operation === "section.restore";
      const [section] = await db().update(sitePageSections).set({ status: restoring ? "active" : "deleted", deletedAt: restoring ? null : new Date(), deletedByUserId: restoring ? null : input.actorUserId, updatedByUserId: input.actorUserId, updatedAt: new Date() }).where(eq(sitePageSections.id, current.id)).returning();
      if (restoring) await markRestored(input.organizationId, "site_page_section", current.id, input.actorUserId);
      else await putTrash({ organizationId: input.organizationId, actorUserId: input.actorUserId, resourceType: "site_page_section", resourceId: current.id, label: current.title ?? current.key, snapshot: plain(current) });
      await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: restoring ? "content.section.restored" : "content.section.deleted", resourceType: "site_page_section", resourceId: current.id, oldValue: current, newValue: section });
      return section;
    }

    if (op.operation === "service.upsert") {
      const current = op.id ? await owned(await db().select().from(siteServices).where(and(eq(siteServices.id, op.id), eq(siteServices.organizationId, input.organizationId))).limit(1), "SERVICE_NOT_FOUND") : null;
      const values = {
        slug: op.slug,
        name: op.name,
        summary: op.summary ?? null,
        description: op.description ?? null,
        status: op.status,
        position: op.position,
        icon: op.icon ?? null,
        imageUrl: op.imageUrl ?? null,
        actionLabel: op.actionLabel ?? null,
        actionUrl: op.actionUrl ?? null,
        config: op.config,
        updatedByUserId: input.actorUserId,
        deletedAt: op.status === "deleted" ? current?.deletedAt ?? new Date() : null,
        deletedByUserId: op.status === "deleted" ? input.actorUserId : null,
        updatedAt: new Date(),
      };
      const [service] = current
        ? await db().update(siteServices).set(values).where(eq(siteServices.id, current.id)).returning()
        : await db().insert(siteServices).values({ organizationId: input.organizationId, createdByUserId: input.actorUserId, ...values }).returning();
      if (!service) throw new Error("SERVICE_SAVE_FAILED");
      await revision({ organizationId: input.organizationId, resourceType: "site_service", resourceId: service.id, snapshot: plain(service), actorUserId: input.actorUserId, summary: op.changeSummary });
      if (op.status === "deleted") await putTrash({ organizationId: input.organizationId, actorUserId: input.actorUserId, resourceType: "site_service", resourceId: service.id, label: service.name, snapshot: plain(current ?? service) });
      await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: current ? "content.service.updated" : "content.service.created", resourceType: "site_service", resourceId: service.id, oldValue: current, newValue: service });
      return service;
    }

    if (op.operation === "service.delete" || op.operation === "service.restore") {
      const current = await owned(await db().select().from(siteServices).where(and(eq(siteServices.id, op.id), eq(siteServices.organizationId, input.organizationId))).limit(1), "SERVICE_NOT_FOUND");
      const restoring = op.operation === "service.restore";
      const [service] = await db().update(siteServices).set({ status: restoring ? "active" : "deleted", deletedAt: restoring ? null : new Date(), deletedByUserId: restoring ? null : input.actorUserId, updatedByUserId: input.actorUserId, updatedAt: new Date() }).where(eq(siteServices.id, current.id)).returning();
      if (restoring) await markRestored(input.organizationId, "site_service", current.id, input.actorUserId);
      else await putTrash({ organizationId: input.organizationId, actorUserId: input.actorUserId, resourceType: "site_service", resourceId: current.id, label: current.name, snapshot: plain(current) });
      await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: restoring ? "content.service.restored" : "content.service.deleted", resourceType: "site_service", resourceId: current.id, oldValue: current, newValue: service });
      return service;
    }

    if (op.operation === "menu.upsert") {
      const current = op.id ? await owned(await db().select().from(siteMenus).where(and(eq(siteMenus.id, op.id), eq(siteMenus.organizationId, input.organizationId))).limit(1), "MENU_NOT_FOUND") : null;
      const values = { key: op.key, name: op.name, status: op.status, settings: op.settings, updatedByUserId: input.actorUserId, deletedAt: op.status === "deleted" ? current?.deletedAt ?? new Date() : null, deletedByUserId: op.status === "deleted" ? input.actorUserId : null, updatedAt: new Date() };
      const [menu] = current
        ? await db().update(siteMenus).set(values).where(eq(siteMenus.id, current.id)).returning()
        : await db().insert(siteMenus).values({ organizationId: input.organizationId, createdByUserId: input.actorUserId, ...values }).returning();
      if (!menu) throw new Error("MENU_SAVE_FAILED");
      if (op.status === "deleted") await putTrash({ organizationId: input.organizationId, actorUserId: input.actorUserId, resourceType: "site_menu", resourceId: menu.id, label: menu.name, snapshot: plain(current ?? menu) });
      await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: current ? "content.menu.updated" : "content.menu.created", resourceType: "site_menu", resourceId: menu.id, oldValue: current, newValue: menu });
      return menu;
    }

    if (op.operation === "menu_item.upsert") {
      await owned(await db().select({ id: siteMenus.id }).from(siteMenus).where(and(eq(siteMenus.id, op.menuId), eq(siteMenus.organizationId, input.organizationId), isNull(siteMenus.deletedAt))).limit(1), "MENU_NOT_FOUND");
      if (op.pageId) await owned(await db().select({ id: sitePages.id }).from(sitePages).where(and(eq(sitePages.id, op.pageId), eq(sitePages.organizationId, input.organizationId), isNull(sitePages.deletedAt))).limit(1), "PAGE_NOT_FOUND");
      const current = op.id ? await owned(await db().select().from(siteMenuItems).where(and(eq(siteMenuItems.id, op.id), eq(siteMenuItems.organizationId, input.organizationId))).limit(1), "MENU_ITEM_NOT_FOUND") : null;
      const values = { menuId: op.menuId, key: op.key, parentKey: op.parentKey ?? null, label: op.label, href: op.href ?? null, pageId: op.pageId ?? null, status: op.status, position: op.position, settings: op.settings, updatedByUserId: input.actorUserId, deletedAt: op.status === "deleted" ? current?.deletedAt ?? new Date() : null, deletedByUserId: op.status === "deleted" ? input.actorUserId : null, updatedAt: new Date() };
      const [item] = current
        ? await db().update(siteMenuItems).set(values).where(eq(siteMenuItems.id, current.id)).returning()
        : await db().insert(siteMenuItems).values({ organizationId: input.organizationId, createdByUserId: input.actorUserId, ...values }).returning();
      if (!item) throw new Error("MENU_ITEM_SAVE_FAILED");
      if (op.status === "deleted") await putTrash({ organizationId: input.organizationId, actorUserId: input.actorUserId, resourceType: "site_menu_item", resourceId: item.id, label: item.label, snapshot: plain(current ?? item) });
      await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: current ? "content.menu_item.updated" : "content.menu_item.created", resourceType: "site_menu_item", resourceId: item.id, oldValue: current, newValue: item });
      return item;
    }

    if (op.operation === "menu_item.delete") {
      const current = await owned(await db().select().from(siteMenuItems).where(and(eq(siteMenuItems.id, op.id), eq(siteMenuItems.organizationId, input.organizationId))).limit(1), "MENU_ITEM_NOT_FOUND");
      const [item] = await db().update(siteMenuItems).set({ status: "deleted", deletedAt: new Date(), deletedByUserId: input.actorUserId, updatedByUserId: input.actorUserId, updatedAt: new Date() }).where(eq(siteMenuItems.id, current.id)).returning();
      await putTrash({ organizationId: input.organizationId, actorUserId: input.actorUserId, resourceType: "site_menu_item", resourceId: current.id, label: current.label, snapshot: plain(current) });
      await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: "content.menu_item.deleted", resourceType: "site_menu_item", resourceId: current.id, oldValue: current, newValue: item });
      return item;
    }

    const savedRevision = await owned(await db().select().from(contentRevisions).where(and(eq(contentRevisions.id, op.id), eq(contentRevisions.organizationId, input.organizationId))).limit(1), "REVISION_NOT_FOUND");
    const snapshot = savedRevision.snapshot;
    if (savedRevision.resourceType === "site_page") {
      const current = await owned(await db().select().from(sitePages).where(and(eq(sitePages.id, savedRevision.resourceId), eq(sitePages.organizationId, input.organizationId))).limit(1), "PAGE_NOT_FOUND");
      const [restored] = await db().update(sitePages).set({
        slug: String(snapshot.slug ?? current.slug), title: String(snapshot.title ?? current.title), excerpt: typeof snapshot.excerpt === "string" ? snapshot.excerpt : null,
        status: snapshot.status === "published" ? "draft" : current.status, template: typeof snapshot.template === "string" ? snapshot.template : current.template,
        position: typeof snapshot.position === "number" ? snapshot.position : current.position, seo: plain(snapshot.seo ?? {}), settings: plain(snapshot.settings ?? {}),
        updatedByUserId: input.actorUserId, updatedAt: new Date(),
      }).where(eq(sitePages.id, current.id)).returning();
      await revision({ organizationId: input.organizationId, resourceType: "site_page", resourceId: current.id, snapshot: plain(restored), actorUserId: input.actorUserId, summary: `Restore revision ${savedRevision.version}` });
      await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: "content.revision.restored", resourceType: "site_page", resourceId: current.id, oldValue: current, newValue: restored });
      return restored;
    }
    if (savedRevision.resourceType === "site_page_section") {
      const current = await owned(await db().select().from(sitePageSections).where(and(eq(sitePageSections.id, savedRevision.resourceId), eq(sitePageSections.organizationId, input.organizationId))).limit(1), "SECTION_NOT_FOUND");
      const [restored] = await db().update(sitePageSections).set({
        key: String(snapshot.key ?? current.key), type: String(snapshot.type ?? current.type) as typeof current.type,
        title: typeof snapshot.title === "string" ? snapshot.title : null, content: plain(snapshot.content ?? {}), settings: plain(snapshot.settings ?? {}),
        status: "active", position: typeof snapshot.position === "number" ? snapshot.position : current.position,
        updatedByUserId: input.actorUserId, updatedAt: new Date(),
      }).where(eq(sitePageSections.id, current.id)).returning();
      await revision({ organizationId: input.organizationId, resourceType: "site_page_section", resourceId: current.id, snapshot: plain(restored), actorUserId: input.actorUserId, summary: `Restore revision ${savedRevision.version}` });
      await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: "content.revision.restored", resourceType: "site_page_section", resourceId: current.id, oldValue: current, newValue: restored });
      return restored;
    }
    if (savedRevision.resourceType === "site_service") {
      const current = await owned(await db().select().from(siteServices).where(and(eq(siteServices.id, savedRevision.resourceId), eq(siteServices.organizationId, input.organizationId))).limit(1), "SERVICE_NOT_FOUND");
      const [restored] = await db().update(siteServices).set({
        slug: String(snapshot.slug ?? current.slug), name: String(snapshot.name ?? current.name), summary: typeof snapshot.summary === "string" ? snapshot.summary : null,
        description: typeof snapshot.description === "string" ? snapshot.description : null, status: "active",
        position: typeof snapshot.position === "number" ? snapshot.position : current.position, icon: typeof snapshot.icon === "string" ? snapshot.icon : null,
        imageUrl: typeof snapshot.imageUrl === "string" ? snapshot.imageUrl : null, actionLabel: typeof snapshot.actionLabel === "string" ? snapshot.actionLabel : null,
        actionUrl: typeof snapshot.actionUrl === "string" ? snapshot.actionUrl : null, config: plain(snapshot.config ?? {}), updatedByUserId: input.actorUserId, updatedAt: new Date(),
      }).where(eq(siteServices.id, current.id)).returning();
      await revision({ organizationId: input.organizationId, resourceType: "site_service", resourceId: current.id, snapshot: plain(restored), actorUserId: input.actorUserId, summary: `Restore revision ${savedRevision.version}` });
      await audit({ organizationId: input.organizationId, actorUserId: input.actorUserId, action: "content.revision.restored", resourceType: "site_service", resourceId: current.id, oldValue: current, newValue: restored });
      return restored;
    }
    throw new ApiError(422, "REVISION_RESOURCE_UNSUPPORTED", "لا يمكن استرجاع هذا النوع من الإصدارات.");
  } catch (error) {
    if (databaseCode(error) === "23505") {
      throw new ApiError(409, "CONTENT_KEY_CONFLICT", "القيمة التعريفية مستخدمة مسبقًا داخل المؤسسة.");
    }
    throw error;
  }
}
