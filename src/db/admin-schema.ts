import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations, users } from "@/db/schema";

export type ManagedContentStatus = "draft" | "active" | "published" | "disabled" | "hidden" | "deleted";
export type PageSectionType = "hero" | "rich_text" | "features" | "services" | "callout" | "image" | "faq" | "cta" | "custom";

export const sitePages = pgTable("site_pages", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt"),
  status: text("status").$type<ManagedContentStatus>().notNull().default("draft"),
  template: text("template").notNull().default("standard"),
  position: integer("position").notNull().default(100),
  seo: jsonb("seo").$type<Record<string, unknown>>().notNull().default({}),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedByUserId: uuid("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("site_pages_org_slug_unique_idx").on(table.organizationId, table.slug),
  index("site_pages_org_status_position_idx").on(table.organizationId, table.status, table.position),
  index("site_pages_org_updated_idx").on(table.organizationId, table.updatedAt),
]);

export const sitePageSections = pgTable("site_page_sections", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  pageId: uuid("page_id").notNull().references(() => sitePages.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  type: text("type").$type<PageSectionType>().notNull().default("rich_text"),
  title: text("title"),
  content: jsonb("content").$type<Record<string, unknown>>().notNull().default({}),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").$type<ManagedContentStatus>().notNull().default("active"),
  position: integer("position").notNull().default(100),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedByUserId: uuid("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("site_page_sections_page_key_unique_idx").on(table.pageId, table.key),
  index("site_page_sections_page_status_position_idx").on(table.pageId, table.status, table.position),
  index("site_page_sections_org_updated_idx").on(table.organizationId, table.updatedAt),
]);

export const siteServices = pgTable("site_services", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  summary: text("summary"),
  description: text("description"),
  status: text("status").$type<ManagedContentStatus>().notNull().default("active"),
  position: integer("position").notNull().default(100),
  icon: text("icon"),
  imageUrl: text("image_url"),
  actionLabel: text("action_label"),
  actionUrl: text("action_url"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedByUserId: uuid("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("site_services_org_slug_unique_idx").on(table.organizationId, table.slug),
  index("site_services_org_status_position_idx").on(table.organizationId, table.status, table.position),
]);

export const siteMenus = pgTable("site_menus", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  status: text("status").$type<ManagedContentStatus>().notNull().default("active"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedByUserId: uuid("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("site_menus_org_key_unique_idx").on(table.organizationId, table.key),
  index("site_menus_org_status_idx").on(table.organizationId, table.status),
]);

export const siteMenuItems = pgTable("site_menu_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  menuId: uuid("menu_id").notNull().references(() => siteMenus.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  parentKey: text("parent_key"),
  label: text("label").notNull(),
  href: text("href"),
  pageId: uuid("page_id").references(() => sitePages.id, { onDelete: "set null" }),
  status: text("status").$type<ManagedContentStatus>().notNull().default("active"),
  position: integer("position").notNull().default(100),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedByUserId: uuid("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("site_menu_items_menu_key_unique_idx").on(table.menuId, table.key),
  index("site_menu_items_menu_status_position_idx").on(table.menuId, table.status, table.position),
]);

export const contentRevisions = pgTable("content_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  resourceType: text("resource_type").notNull(),
  resourceId: uuid("resource_id").notNull(),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  changeSummary: text("change_summary"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("content_revisions_resource_version_unique_idx").on(table.organizationId, table.resourceType, table.resourceId, table.version),
  index("content_revisions_resource_created_idx").on(table.organizationId, table.resourceType, table.resourceId, table.createdAt),
]);

export const userMfaCredentials = pgTable("user_mfa_credentials", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  encryptedSecret: text("encrypted_secret").notNull(),
  secretHint: text("secret_hint").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  enabledAt: timestamp("enabled_at", { withTimezone: true }),
  lastUsedStep: integer("last_used_step"),
  recoveryCodeHashes: jsonb("recovery_code_hashes").$type<string[]>().notNull().default([]),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("user_mfa_credentials_enabled_idx").on(table.enabled),
  index("user_mfa_credentials_locked_idx").on(table.lockedUntil),
]);
