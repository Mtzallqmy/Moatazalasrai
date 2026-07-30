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
import { mcpServers, organizations, users } from "./schema";

export const mcpResources = pgTable("mcp_resources", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  serverId: uuid("server_id").notNull().references(() => mcpServers.id, { onDelete: "cascade" }),
  uri: text("uri").notNull(),
  name: text("name").notNull(),
  title: text("title"),
  description: text("description"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  annotations: jsonb("annotations").$type<Record<string, unknown>>().notNull().default({}),
  icons: jsonb("icons").$type<Array<Record<string, unknown>>>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("mcp_resources_server_uri_idx").on(table.serverId, table.uri),
  index("mcp_resources_org_enabled_idx").on(table.organizationId, table.enabled),
]);

export const mcpResourceTemplates = pgTable("mcp_resource_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  serverId: uuid("server_id").notNull().references(() => mcpServers.id, { onDelete: "cascade" }),
  uriTemplate: text("uri_template").notNull(),
  name: text("name").notNull(),
  title: text("title"),
  description: text("description"),
  mimeType: text("mime_type"),
  annotations: jsonb("annotations").$type<Record<string, unknown>>().notNull().default({}),
  icons: jsonb("icons").$type<Array<Record<string, unknown>>>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("mcp_resource_templates_server_uri_idx").on(table.serverId, table.uriTemplate),
  index("mcp_resource_templates_org_enabled_idx").on(table.organizationId, table.enabled),
]);

export const mcpPrompts = pgTable("mcp_prompts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  serverId: uuid("server_id").notNull().references(() => mcpServers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  title: text("title"),
  description: text("description"),
  arguments: jsonb("arguments").$type<Array<Record<string, unknown>>>().notNull().default([]),
  icons: jsonb("icons").$type<Array<Record<string, unknown>>>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("mcp_prompts_server_name_idx").on(table.serverId, table.name),
  index("mcp_prompts_org_enabled_idx").on(table.organizationId, table.enabled),
]);

export const mcpContentReads = pgTable("mcp_content_reads", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  serverId: uuid("server_id").notNull().references(() => mcpServers.id, { onDelete: "cascade" }),
  requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  identifier: text("identifier").notNull(),
  status: text("status").notNull().default("running"),
  payloadBytes: integer("payload_bytes"),
  resultDigest: text("result_digest"),
  errorCode: text("error_code"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("mcp_content_reads_org_created_idx").on(table.organizationId, table.createdAt),
  index("mcp_content_reads_server_kind_idx").on(table.serverId, table.kind),
]);
