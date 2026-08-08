import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { getPostgresPool } from "@/db/pool";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { supabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const LEGACY_SESSION_COOKIE = "moataz_session";

function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function markCurrentSessionReauthenticated() {
  if (supabaseAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    const sessionId = typeof data?.claims?.session_id === "string" ? data.claims.session_id : null;
    if (!sessionId) return false;
    const result = await getPostgresPool().query(`
      UPDATE sessions SET reauthenticated_at = now()
      WHERE supabase_session_id = $1 AND auth_source = 'supabase' AND revoked_at IS NULL AND expires_at > now()
    `, [sessionId]);
    return result.rowCount === 1;
  }
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
