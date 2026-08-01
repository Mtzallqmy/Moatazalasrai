ALTER TABLE "attachments" ALTER COLUMN "content" DROP NOT NULL;
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "storage_driver" text NOT NULL DEFAULT 'database';
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "object_key" text;

CREATE UNIQUE INDEX IF NOT EXISTS "attachments_storage_object_idx"
  ON "attachments" ("storage_driver", "object_key")
  WHERE "object_key" IS NOT NULL;

ALTER TABLE "attachments" ADD CONSTRAINT "attachments_storage_payload_check"
  CHECK (
    ("storage_driver" = 'database' AND "content" IS NOT NULL AND "object_key" IS NULL)
    OR
    ("storage_driver" IN ('local', 'r2') AND "content" IS NULL AND "object_key" IS NOT NULL)
  ) NOT VALID;
ALTER TABLE "attachments" VALIDATE CONSTRAINT "attachments_storage_payload_check";

CREATE TABLE IF NOT EXISTS "turnstile_verifications" (
  "token_hash" text PRIMARY KEY,
  "action" text NOT NULL,
  "verified_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "turnstile_verifications_expires_idx"
  ON "turnstile_verifications" ("expires_at");
