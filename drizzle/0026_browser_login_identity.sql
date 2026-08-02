CREATE OR REPLACE FUNCTION browser_login_session_use_external_uuid()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.external_session_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    NEW.id := NEW.external_session_id::uuid;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS browser_login_sessions_external_uuid_trigger ON browser_login_sessions;
--> statement-breakpoint
CREATE TRIGGER browser_login_sessions_external_uuid_trigger
BEFORE INSERT ON browser_login_sessions
FOR EACH ROW EXECUTE FUNCTION browser_login_session_use_external_uuid();
