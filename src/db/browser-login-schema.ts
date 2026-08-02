import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "@/db/schema";
import { siteConnections } from "@/db/site-connections-schema";

export const browserLoginStatus = pgEnum("browser_login_status", [
  "active",
  "completed",
  "cancelled",
  "expired",
  "failed",
]);

export const browserLoginSessions = pgTable("browser_login_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  siteConnectionId: uuid("site_connection_id").notNull().references(() => siteConnections.id, { onDelete: "cascade" }),
  externalSessionId: text("external_session_id").notNull(),
  status: browserLoginStatus("status").notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("browser_login_sessions_external_unique_idx").on(table.externalSessionId),
  index("browser_login_sessions_org_connection_idx").on(table.organizationId, table.siteConnectionId, table.status),
  index("browser_login_sessions_expiry_idx").on(table.expiresAt),
]);
