import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents, organizations, users } from "@/db/schema";

export const agentToolBindings = pgTable("agent_tool_bindings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  approvalMode: text("approval_mode").notNull().default("risk_based"),
  constraints: jsonb("constraints").$type<Record<string, unknown>>().notNull().default({}),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("agent_tool_bindings_agent_tool_unique_idx").on(table.organizationId, table.agentId, table.toolName),
  index("agent_tool_bindings_org_agent_enabled_idx").on(table.organizationId, table.agentId, table.enabled),
]);
