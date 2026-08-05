import { sql } from "drizzle-orm";
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
import { organizationMembers, organizations, users } from "@/db/schema";

export type ModuleStatus = "active" | "disabled" | "hidden" | "deleted";
export type NotificationChannel = "whatsapp" | "email" | "push" | "internal";
export type NotificationStatus = "queued" | "processing" | "sent" | "delivered" | "read" | "failed" | "skipped";

export const platformModules = pgTable("platform_modules", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").$type<ModuleStatus>().notNull().default("active"),
  position: integer("position").notNull().default(100),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedByUserId: uuid("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("platform_modules_org_key_unique_idx").on(table.organizationId, table.key),
  index("platform_modules_org_status_position_idx").on(table.organizationId, table.status, table.position),
]);

export const featureFlags = pgTable("feature_flags", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(false),
  rolloutPercentage: integer("rollout_percentage").notNull().default(100),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("feature_flags_org_key_unique_idx").on(table.organizationId, table.key),
  index("feature_flags_org_enabled_idx").on(table.organizationId, table.enabled),
]);

export const customRoles = pgTable("custom_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  system: boolean("system").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("custom_roles_org_key_unique_idx").on(table.organizationId, table.key),
  index("custom_roles_org_enabled_idx").on(table.organizationId, table.enabled, table.deletedAt),
]);

export const customRolePermissions = pgTable("custom_role_permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => customRoles.id, { onDelete: "cascade" }),
  permission: text("permission").notNull(),
  allowed: boolean("allowed").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("custom_role_permissions_role_permission_unique_idx").on(table.roleId, table.permission),
  index("custom_role_permissions_org_role_idx").on(table.organizationId, table.roleId),
]);

export const memberCustomRoles = pgTable("member_custom_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  organizationMemberId: uuid("organization_member_id").notNull().references(() => organizationMembers.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => customRoles.id, { onDelete: "cascade" }),
  assignedByUserId: uuid("assigned_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("member_custom_roles_member_role_unique_idx").on(table.organizationMemberId, table.roleId),
  index("member_custom_roles_org_member_idx").on(table.organizationId, table.organizationMemberId),
]);

export const platformSettings = pgTable("platform_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  namespace: text("namespace").notNull().default("general"),
  key: text("key").notNull(),
  value: jsonb("value").$type<unknown>().notNull(),
  sensitive: boolean("sensitive").notNull().default(false),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("platform_settings_org_namespace_key_unique_idx").on(table.organizationId, table.namespace, table.key),
  index("platform_settings_org_namespace_idx").on(table.organizationId, table.namespace),
]);

export const deletedItems = pgTable("deleted_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  label: text("label"),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
  deletedByUserId: uuid("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).defaultNow().notNull(),
  restorableUntil: timestamp("restorable_until", { withTimezone: true }),
  restoredByUserId: uuid("restored_by_user_id").references(() => users.id, { onDelete: "set null" }),
  restoredAt: timestamp("restored_at", { withTimezone: true }),
  permanentlyDeletedByUserId: uuid("permanently_deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  permanentlyDeletedAt: timestamp("permanently_deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("deleted_items_org_resource_unique_idx").on(table.organizationId, table.resourceType, table.resourceId),
  index("deleted_items_org_active_idx").on(table.organizationId, table.restoredAt, table.permanentlyDeletedAt, table.deletedAt),
]);

export const domainEvents = pgTable("domain_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  eventKey: text("event_key").notNull(),
  actorType: text("actor_type").notNull().default("system"),
  actorId: text("actor_id"),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: text("idempotency_key"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("domain_events_org_idempotency_unique_idx").on(table.organizationId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL`),
  index("domain_events_org_key_created_idx").on(table.organizationId, table.eventKey, table.createdAt),
  index("domain_events_pending_idx").on(table.processedAt, table.createdAt),
]);

export const notificationTemplates = pgTable("notification_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  channel: text("channel").$type<NotificationChannel>().notNull(),
  eventKey: text("event_key").notNull(),
  locale: text("locale").notNull().default("ar"),
  subject: text("subject"),
  body: text("body").notNull(),
  variables: jsonb("variables").$type<string[]>().notNull().default([]),
  whatsappTemplateName: text("whatsapp_template_name"),
  whatsappTemplateStatus: text("whatsapp_template_status").notNull().default("not_submitted"),
  enabled: boolean("enabled").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("notification_templates_org_key_unique_idx").on(table.organizationId, table.key),
  index("notification_templates_org_event_channel_idx").on(table.organizationId, table.eventKey, table.channel, table.enabled),
]);

export const notificationRules = pgTable("notification_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  eventKey: text("event_key").notNull(),
  channel: text("channel").$type<NotificationChannel>().notNull(),
  templateId: uuid("template_id").notNull().references(() => notificationTemplates.id, { onDelete: "cascade" }),
  audienceType: text("audience_type").notNull().default("event_user"),
  audienceConfig: jsonb("audience_config").$type<Record<string, unknown>>().notNull().default({}),
  priority: integer("priority").notNull().default(100),
  enabled: boolean("enabled").notNull().default(true),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("notification_rules_org_event_enabled_idx").on(table.organizationId, table.eventKey, table.enabled, table.priority),
]);

export const notificationDeliveries = pgTable("notification_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => domainEvents.id, { onDelete: "cascade" }),
  ruleId: uuid("rule_id").references(() => notificationRules.id, { onDelete: "set null" }),
  templateId: uuid("template_id").references(() => notificationTemplates.id, { onDelete: "set null" }),
  channel: text("channel").$type<NotificationChannel>().notNull(),
  recipient: text("recipient").notNull(),
  status: text("status").$type<NotificationStatus>().notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  providerMessageId: text("provider_message_id"),
  lastErrorCode: text("last_error_code"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).defaultNow().notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("notification_deliveries_event_rule_recipient_unique_idx").on(table.eventId, table.ruleId, table.recipient),
  index("notification_deliveries_org_status_scheduled_idx").on(table.organizationId, table.status, table.scheduledAt),
]);

export const internalNotifications = pgTable("internal_notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deliveryId: uuid("delivery_id").references(() => notificationDeliveries.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("internal_notifications_user_read_created_idx").on(table.userId, table.readAt, table.createdAt),
  index("internal_notifications_org_created_idx").on(table.organizationId, table.createdAt),
]);
