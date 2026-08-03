import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations, providerCredentials, runs } from "./schema";

export const providerCredentialHealthEvents = pgTable("provider_credential_health_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  providerCredentialId: uuid("provider_credential_id").notNull().references(() => providerCredentials.id, { onDelete: "cascade" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  outcome: text("outcome").notNull(),
  model: text("model").notNull(),
  errorCode: text("error_code"),
  errorCategory: text("error_category"),
  requestId: text("request_id"),
  providerRequestId: text("provider_request_id"),
  latencyMs: integer("latency_ms"),
  providerStatus: integer("provider_status"),
  retryable: boolean("retryable"),
  circuitOpenUntil: timestamp("circuit_open_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("provider_health_events_org_created_idx").on(table.organizationId, table.createdAt),
  index("provider_health_events_credential_created_idx").on(table.providerCredentialId, table.createdAt),
  index("provider_health_events_run_idx").on(table.runId),
]);
