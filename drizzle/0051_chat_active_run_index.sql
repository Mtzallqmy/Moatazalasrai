CREATE INDEX IF NOT EXISTS "runs_conversation_active_idx"
  ON "runs" ("conversation_id")
  WHERE "status" IN ('queued', 'running', 'waiting_approval');
