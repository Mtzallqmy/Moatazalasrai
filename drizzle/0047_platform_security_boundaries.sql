-- Production hardening: independent platform operations identity and mobile MFA challenges.
-- This migration is additive and intentionally leaves tenant roles unchanged.

CREATE TABLE IF NOT EXISTS "platform_admins" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "platform_admins_role_check" CHECK ("role" IN ('admin', 'operator'))
);
CREATE INDEX IF NOT EXISTS "platform_admins_active_role_idx" ON "platform_admins" ("active", "role");

CREATE TABLE IF NOT EXISTS "platform_admin_audit_logs" (
  "id" bigserial PRIMARY KEY,
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "action" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text,
  "request_id" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "platform_admin_audit_action_check" CHECK (char_length("action") BETWEEN 3 AND 200)
);
CREATE INDEX IF NOT EXISTS "platform_admin_audit_actor_created_idx" ON "platform_admin_audit_logs" ("actor_user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "platform_admin_audit_action_created_idx" ON "platform_admin_audit_logs" ("action", "created_at" DESC);

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "reauthenticated_at" timestamptz;

CREATE TABLE IF NOT EXISTS "mobile_mfa_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "token_hash" text NOT NULL UNIQUE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "device_id" text NOT NULL,
  "device_name" text,
  "remember_session" boolean NOT NULL DEFAULT true,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mobile_mfa_challenges_attempts_check" CHECK ("attempt_count" BETWEEN 0 AND 10),
  CONSTRAINT "mobile_mfa_challenges_device_check" CHECK (char_length("device_id") BETWEEN 8 AND 200)
);
CREATE INDEX IF NOT EXISTS "mobile_mfa_challenges_user_expiry_idx" ON "mobile_mfa_challenges" ("user_id", "expires_at");
CREATE INDEX IF NOT EXISTS "mobile_mfa_challenges_expiry_idx" ON "mobile_mfa_challenges" ("expires_at", "used_at");

-- Tenant roles are deliberately prevented from becoming platform roles by construction:
-- platform_admins has no organization_id and no FK/path from organization_members.
