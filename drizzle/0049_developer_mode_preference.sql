-- User-facing preference only; operational permissions remain server-side and independent.
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS developer_mode_enabled boolean NOT NULL DEFAULT false;
