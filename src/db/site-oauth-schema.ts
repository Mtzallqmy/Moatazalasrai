import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "@/db/schema";
import { siteConnections } from "@/db/site-connections-schema";

export const siteOauthStates = pgTable("site_oauth_states", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  siteConnectionId: uuid("site_connection_id").notNull().references(() => siteConnections.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  stateHash: text("state_hash").notNull(),
  nonceHash: text("nonce_hash").notNull(),
  encryptedCodeVerifier: text("encrypted_code_verifier").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  requestedScopes: text("requested_scopes").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("site_oauth_states_state_hash_unique_idx").on(table.stateHash),
  index("site_oauth_states_org_connection_idx").on(table.organizationId, table.siteConnectionId, table.expiresAt),
  index("site_oauth_states_expiry_idx").on(table.expiresAt),
]);
