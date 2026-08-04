-- Stores only the previous refresh-token digest so concurrent replay is detected deterministically.
ALTER TABLE "mobile_sessions"
  ADD COLUMN "previous_refresh_token_hash" text;

CREATE UNIQUE INDEX "mobile_sessions_previous_refresh_hash_idx"
  ON "mobile_sessions" ("previous_refresh_token_hash");
