import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents, conversations, organizations, users } from "./schema";

export type ChannelSessionState = Record<string, unknown>;

const commonColumns = {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  activeFlow: text("active_flow"),
  currentStep: text("current_step"),
  selectedAgentId: uuid("selected_agent_id").references(() => agents.id, { onDelete: "set null" }),
  selectedTeamId: uuid("selected_team_id"),
  selectedConversationId: uuid("selected_conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  state: jsonb("state").$type<ChannelSessionState>().notNull().default({}),
  version: integer("version").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const telegramUserSessions = pgTable("telegram_user_sessions", {
  ...commonColumns,
  telegramUserId: text("telegram_user_id").notNull(),
  telegramChatId: text("telegram_chat_id").notNull(),
}, (table) => [
  uniqueIndex("telegram_user_sessions_telegram_user_unique_idx").on(table.telegramUserId),
  uniqueIndex("telegram_user_sessions_user_unique_idx").on(table.userId),
  index("telegram_user_sessions_org_updated_idx").on(table.organizationId, table.updatedAt),
  index("telegram_user_sessions_flow_expiry_idx").on(table.activeFlow, table.expiresAt),
]);

export const whatsappUserSessions = pgTable("whatsapp_user_sessions", {
  ...commonColumns,
  whatsappWaId: text("whatsapp_wa_id").notNull(),
  whatsappChatId: text("whatsapp_chat_id").notNull(),
}, (table) => [
  uniqueIndex("whatsapp_user_sessions_wa_id_unique_idx").on(table.whatsappWaId),
  uniqueIndex("whatsapp_user_sessions_user_unique_idx").on(table.userId),
  index("whatsapp_user_sessions_org_updated_idx").on(table.organizationId, table.updatedAt),
  index("whatsapp_user_sessions_flow_expiry_idx").on(table.activeFlow, table.expiresAt),
]);

export type TelegramUserSession = typeof telegramUserSessions.$inferSelect;
export type WhatsAppUserSession = typeof whatsappUserSessions.$inferSelect;
