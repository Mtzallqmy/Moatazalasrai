-- Rollback for 0033_security_hardening.sql.
DROP TRIGGER IF EXISTS "audit_logs_reject_truncate" ON "audit_logs";
DROP TRIGGER IF EXISTS "audit_logs_reject_update_delete" ON "audit_logs";
DROP FUNCTION IF EXISTS "reject_audit_log_mutation"();

ALTER TABLE "audit_logs"
  DROP CONSTRAINT IF EXISTS "audit_logs_organization_id_preserve_fk";

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id")
  REFERENCES "organizations"("id")
  ON DELETE CASCADE;

DROP TABLE IF EXISTS "bootstrap_admin_tokens";
DROP TABLE IF EXISTS "mfa_session_verifications";
DROP TABLE IF EXISTS "user_mfa_recovery_codes";
DROP TABLE IF EXISTS "user_totp_factors";
