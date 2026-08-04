-- Rollback for 0033_security_hardening.sql.
DROP TRIGGER IF EXISTS "audit_logs_reject_truncate" ON "audit_logs";
DROP TRIGGER IF EXISTS "audit_logs_reject_update_delete" ON "audit_logs";
DROP FUNCTION IF EXISTS "reject_audit_log_mutation"();
DROP TABLE IF EXISTS "bootstrap_admin_tokens";
DROP TABLE IF EXISTS "mfa_session_verifications";
DROP TABLE IF EXISTS "user_mfa_recovery_codes";
DROP TABLE IF EXISTS "user_totp_factors";
