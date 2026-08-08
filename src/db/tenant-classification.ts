/**
 * PostgreSQL tenant-data classification used by production hardening.
 *
 * directTenant: all public base tables with an exact `organization_id` column.
 * Migration 0048 generates their RLS policy from the database catalog.
 */
export const TENANT_DATA_CLASSIFICATION = {
  directTenantRule: "public base table with organization_id",
  derivedTenant: [
    "agent_versions",
    "messages",
    "run_events",
    "telegram_updates",
    "execution_steps",
    "execution_events",
    "execution_leases",
  ],
  sharedIdentity: [
    "organizations",
    "users",
    "user_preferences",
    "sessions",
    "user_mfa_credentials",
    "whatsapp_link_tokens",
  ],
  platformOwned: [
    "platform_admins",
    "platform_admin_audit_logs",
    "platform_runtime_settings",
    "platform_whatsapp_endpoints",
    "platform_whatsapp_defaults",
  ],
  systemInternal: [
    "_platform_migrations",
    "rate_limits",
    "turnstile_verifications",
    "whatsapp_webhook_events",
    "worker_heartbeats",
  ],
} as const;

export type TenantDataClassification = typeof TENANT_DATA_CLASSIFICATION;
