import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agentTeams, agents, conversations, organizations, users } from "./schema";

export type WhatsAppSessionState = Record<string, unknown>;

export const whatsappUserSessions = pgTable("whatsapp_user_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  whatsappWaId: text("whatsapp_wa_id").notNull(),
  whatsappChatId: text("whatsapp_chat_id").notNull(),
  activeFlow: text("active_flow"),
  currentStep: text("current_step"),
  selectedAgentId: uuid("selected_agent_id").references(() => agents.id, { onDelete: "set null" }),
  selectedTeamId: uuid("selected_team_id").references(() => agentTeams.id, { onDelete: "set null" }),
  selectedConversationId: uuid("selected_conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  state: jsonb("state").$type<WhatsAppSessionState>().notNull().default({}),
  version: integer("version").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("whatsapp_user_sessions_user_unique_idx").on(table.userId),
  uniqueIndex("whatsapp_user_sessions_wa_id_unique_idx").on(table.whatsappWaId),
  index("whatsapp_user_sessions_org_updated_idx").on(table.organizationId, table.updatedAt),
  index("whatsapp_user_sessions_expiry_idx").on(table.expiresAt),
]);

export type WhatsAppUserSession = typeof whatsappUserSessions.$inferSelect;
