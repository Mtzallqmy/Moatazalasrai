import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { getPostgresPool } from "@/db/pool";
import { SESSION_COOKIE } from "@/lib/auth/session";

const LEGACY_SESSION_COOKIE = "moataz_session";

function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function markCurrentSessionReauthenticated() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value
    ?? (SESSION_COOKIE !== LEGACY_SESSION_COOKIE ? store.get(LEGACY_SESSION_COOKIE)?.value : undefined);
  if (!token) return false;
  const result = await getPostgresPool().query(`
    UPDATE sessions
    SET reauthenticated_at = now()
    WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
  `, [hashToken(token)]);
  return result.rowCount === 1;
}
