DO $$
BEGIN
  ALTER TYPE attachment_processing_status ADD VALUE IF NOT EXISTS 'partially_ready';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

UPDATE attachments
SET processing_status = 'partially_ready'
WHERE processing_status = 'ready'
  AND processing_error IS NOT NULL
  AND COALESCE(extracted_text, '') <> '';

UPDATE attachments
SET processing_status = 'failed'
WHERE processing_status = 'unsupported';
