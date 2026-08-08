import { getPostgresPool } from "@/db/pool";

export async function developerModeEnabled(userId: string) {
  const result = await getPostgresPool().query<{ developer_mode_enabled: boolean }>(`
    SELECT developer_mode_enabled
    FROM user_preferences
    WHERE user_id = $1
    LIMIT 1
  `, [userId]);
  return result.rows[0]?.developer_mode_enabled ?? false;
}

export async function setDeveloperMode(userId: string, enabled: boolean) {
  const result = await getPostgresPool().query<{ developer_mode_enabled: boolean }>(`
    INSERT INTO user_preferences (user_id, developer_mode_enabled)
    VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET
      developer_mode_enabled = EXCLUDED.developer_mode_enabled,
      updated_at = now()
    RETURNING developer_mode_enabled
  `, [userId, enabled]);
  return result.rows[0]?.developer_mode_enabled ?? enabled;
}
