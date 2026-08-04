import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { mobileSessions, sessions, users } from "@/db/schema";

export const userTotpFactors = pgTable("user_totp_factors", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  encryptedSecret: text("encrypted_secret").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  lastUsedCounter: text("last_used_counter").$type<string | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userMfaRecoveryCodes = pgTable("user_mfa_recovery_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  encryptedCode: text("encrypted_code").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("user_mfa_recovery_codes_user_unused_idx").on(table.userId, table.createdAt),
]);

export const mfaSessionVerifications = pgTable("mfa_session_verifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }),
  mobileSessionId: uuid("mobile_session_id").references(() => mobileSessions.id, { onDelete: "cascade" }),
  method: text("method").$type<"totp" | "recovery">().notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("mfa_session_verifications_web_session_idx").on(table.sessionId),
  uniqueIndex("mfa_session_verifications_mobile_session_idx").on(table.mobileSessionId),
  index("mfa_session_verifications_expiry_idx").on(table.expiresAt),
]);

export const bootstrapAdminTokens = pgTable("bootstrap_admin_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  permanentlyDisabled: boolean("permanently_disabled").notNull().default(false),
  usedRequestId: text("used_request_id"),
  usedIpHash: text("used_ip_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
