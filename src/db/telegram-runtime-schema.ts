import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agentTeams, agents, conversations, organizations, users } from "./schema";

export const telegramUserSessions = pgTable("telegram_user_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  telegramUserId: text("telegram_user_id").notNull(),
  telegramChatId: text("telegram_chat_id").notNull(),
  activeFlow: text("active_flow"),
  currentStep: text("current_step"),
  selectedAgentId: uuid("selected_agent_id").references(() => agents.id, { onDelete: "set null" }),
  selectedTeamId: uuid("selected_team_id").references(() => agentTeams.id, { onDelete: "set null" }),
  selectedConversationId: uuid("selected_conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
  version: integer("version").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("telegram_user_sessions_user_unique_idx").on(table.userId),
  uniqueIndex("telegram_user_sessions_telegram_unique_idx").on(table.telegramUserId),
  index("telegram_user_sessions_org_updated_idx").on(table.organizationId, table.updatedAt),
  index("telegram_user_sessions_expiry_idx").on(table.expiresAt),
]);
