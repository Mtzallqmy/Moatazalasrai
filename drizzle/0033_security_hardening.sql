-- Security hardening: TOTP MFA, encrypted recovery codes, one-time bootstrap control,
-- and immutable audit records. No RLS policies are created or modified here.

CREATE TABLE "user_totp_factors" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "encrypted_secret" text NOT NULL,
  "verified_at" timestamptz,
  "last_used_counter" bigint,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "user_mfa_recovery_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL UNIQUE,
  "encrypted_code" text NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "user_mfa_recovery_codes_user_unused_idx"
  ON "user_mfa_recovery_codes" ("user_id", "created_at")
  WHERE "used_at" IS NULL;

CREATE TABLE "mfa_session_verifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "session_id" uuid REFERENCES "sessions"("id") ON DELETE CASCADE,
  "mobile_session_id" uuid REFERENCES "mobile_sessions"("id") ON DELETE CASCADE,
  "method" text NOT NULL CHECK ("method" IN ('totp', 'recovery')),
  "verified_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "mfa_session_verifications_target_check" CHECK (
    (("session_id" IS NOT NULL)::int + ("mobile_session_id" IS NOT NULL)::int) = 1
  )
);

CREATE UNIQUE INDEX "mfa_session_verifications_web_session_idx"
  ON "mfa_session_verifications" ("session_id")
  WHERE "session_id" IS NOT NULL;

CREATE UNIQUE INDEX "mfa_session_verifications_mobile_session_idx"
  ON "mfa_session_verifications" ("mobile_session_id")
  WHERE "mobile_session_id" IS NOT NULL;

CREATE INDEX "mfa_session_verifications_expiry_idx"
  ON "mfa_session_verifications" ("expires_at");

CREATE TABLE "bootstrap_admin_tokens" (
  "id" text PRIMARY KEY CHECK ("id" = 'admin'),
  "token_hash" text,
  "expires_at" timestamptz,
  "used_at" timestamptz,
  "disabled_at" timestamptz,
  "permanently_disabled" boolean NOT NULL DEFAULT false,
  "used_request_id" text,
  "used_ip_hash" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Preserve audit records if an organization is removed. The previous cascade would
-- erase the very evidence this migration is intended to protect.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname
    INTO constraint_name
  FROM pg_constraint c
  WHERE c.contype = 'f'
    AND c.conrelid = 'public.audit_logs'::regclass
    AND c.confrelid = 'public.organizations'::regclass
    AND c.conkey = ARRAY[
      (SELECT a.attnum
       FROM pg_attribute a
       WHERE a.attrelid = 'public.audit_logs'::regclass
         AND a.attname = 'organization_id')
    ]::smallint[]
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.audit_logs DROP CONSTRAINT %I', constraint_name);
  END IF;
END;
$$;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_organization_id_preserve_fk"
  FOREIGN KEY ("organization_id")
  REFERENCES "organizations"("id")
  ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION "reject_audit_log_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- PostgreSQL implements ON DELETE SET NULL through an internal trigger. Permit
  -- only that exact nested mutation; all application-issued changes remain denied.
  IF TG_OP = 'UPDATE'
     AND pg_trigger_depth() > 1
     AND OLD.organization_id IS NOT NULL
     AND NEW.organization_id IS NULL
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.actor_type IS NOT DISTINCT FROM OLD.actor_type
     AND NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id
     AND NEW.action IS NOT DISTINCT FROM OLD.action
     AND NEW.resource_type IS NOT DISTINCT FROM OLD.resource_type
     AND NEW.resource_id IS NOT DISTINCT FROM OLD.resource_id
     AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;

CREATE TRIGGER "audit_logs_reject_update_delete"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION "reject_audit_log_mutation"();

CREATE TRIGGER "audit_logs_reject_truncate"
BEFORE TRUNCATE ON "audit_logs"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_audit_log_mutation"();
