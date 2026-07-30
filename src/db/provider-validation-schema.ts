import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations, providerKind, users } from "@/db/schema";

export const providerValidationSessions = pgTable("provider_validation_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: providerKind("provider").notNull(),
  providerSlug: text("provider_slug").notNull(),
  normalizedBaseUrl: text("normalized_base_url").notNull(),
  apiKeyHash: text("api_key_hash").notNull(),
  models: jsonb("models").$type<string[]>().notNull().default([]),
  testedModel: text("tested_model").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("provider_validation_sessions_scope_idx").on(table.organizationId, table.userId, table.expiresAt),
  index("provider_validation_sessions_expiry_idx").on(table.expiresAt),
]);
