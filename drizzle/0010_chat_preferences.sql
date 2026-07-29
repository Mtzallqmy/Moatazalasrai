CREATE TABLE IF NOT EXISTS "user_preferences" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "chat_theme" text NOT NULL DEFAULT 'moataz',
  "chat_wallpaper" text NOT NULL DEFAULT 'soft-grid',
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_preferences_chat_theme_check"
    CHECK ("chat_theme" IN ('moataz', 'whatsapp', 'telegram')),
  CONSTRAINT "user_preferences_chat_wallpaper_check"
    CHECK ("chat_wallpaper" IN ('clean', 'soft-grid', 'doodles', 'bubbles'))
);
