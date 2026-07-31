WITH ranked_messages AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY conversation_id, client_request_id
      ORDER BY created_at ASC, id ASC
    ) AS duplicate_rank
  FROM messages
  WHERE client_request_id IS NOT NULL
)
UPDATE messages
SET client_request_id = NULL
WHERE id IN (
  SELECT id FROM ranked_messages WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS messages_conversation_client_request_unique_idx
  ON messages (conversation_id, client_request_id);
