import { randomBytes, scrypt } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const { Pool } = pg;

function deriveKey(password, salt, length) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function hashPassword(password) {
  if (password.length < 12 || password.length > 128) {
    throw new Error("OWNER_INITIAL_PASSWORD must contain 12 to 128 characters.");
  }
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, 64);
  return ["scrypt", salt.toString("base64url"), derived.toString("base64url")].join(".");
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required before bootstrapping the owner account.");

const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
const password = process.env.OWNER_INITIAL_PASSWORD;
const name = process.env.OWNER_NAME?.trim() || "معتز العلقمي";
const organizationName = process.env.OWNER_ORGANIZATION_NAME?.trim() || "Moataz Agent Platform";
const rotatePassword = process.env.OWNER_ROTATE_PASSWORD?.trim().toLowerCase() === "true";

if (!email || !password) {
  console.log(JSON.stringify({ level: "info", event: "owner.bootstrap.skipped", reason: "OWNER_EMAIL or OWNER_INITIAL_PASSWORD is not configured" }));
  process.exit(0);
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 20_000,
});
const client = await pool.connect();

try {
  await client.query("BEGIN");
  const existingUsers = await client.query(
    "select id, password_hash from users where email = $1 limit 1",
    [email],
  );
  let userId = existingUsers.rows[0]?.id;

  if (!userId) {
    const passwordHash = await hashPassword(password);
    const inserted = await client.query(
      `insert into users (email, name, password_hash)
       values ($1, $2, $3)
       returning id`,
      [email, name, passwordHash],
    );
    userId = inserted.rows[0]?.id;
    if (!userId) throw new Error("Owner user could not be created.");
  } else if (!existingUsers.rows[0]?.password_hash || rotatePassword) {
    const passwordHash = await hashPassword(password);
    await client.query(
      "update users set password_hash = $1, name = coalesce(name, $2), updated_at = now() where id = $3",
      [passwordHash, name, userId],
    );
    await client.query(
      "update sessions set revoked_at = now() where user_id = $1 and revoked_at is null",
      [userId],
    );
  }

  const memberships = await client.query(
    "select organization_id from organization_members where user_id = $1 order by created_at asc limit 1",
    [userId],
  );
  let organizationId = memberships.rows[0]?.organization_id;

  if (!organizationId) {
    const slug = `moataz-${randomBytes(4).toString("hex")}`;
    const insertedOrganizations = await client.query(
      `insert into organizations (name, slug)
       values ($1, $2)
       returning id`,
      [organizationName, slug],
    );
    organizationId = insertedOrganizations.rows[0]?.id;
    if (!organizationId) throw new Error("Owner organization could not be created.");
    await client.query(
      `insert into organization_members (organization_id, user_id, role)
       values ($1, $2, 'owner')
       on conflict (organization_id, user_id) do update set role = 'owner'`,
      [organizationId, userId],
    );
  } else {
    await client.query(
      "update organization_members set role = 'owner', expires_at = null, updated_at = now() where organization_id = $1 and user_id = $2",
      [organizationId, userId],
    );
  }

  await client.query(
    `insert into audit_logs (organization_id, actor_type, actor_id, action, resource_type, resource_id, metadata)
     values ($1, 'bootstrap', $2, $3, 'user', $4, jsonb_build_object('passwordRotated', $5::boolean))`,
    [organizationId, String(userId), rotatePassword ? "owner.password_rotated" : "owner.bootstrap.verified", String(userId), rotatePassword],
  );
  await client.query("COMMIT");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (supabaseUrl && supabaseSecretKey) {
    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    let authUser = null;
    for (let page = 1; page <= 20 && !authUser; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
      if (error) throw new Error(`Supabase owner lookup failed: ${error.code ?? "AUTH_ERROR"}`);
      authUser = data.users.find((candidate) => candidate.email?.toLowerCase() === email) ?? null;
      if (data.users.length < 100) break;
    }
    if (!authUser) {
      const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
      if (error || !data.user) throw new Error(`Supabase owner creation failed: ${error?.code ?? "AUTH_ERROR"}`);
      authUser = data.user;
    } else if (rotatePassword) {
      const { data, error } = await supabase.auth.admin.updateUserById(authUser.id, { password, email_confirm: true, user_metadata: { full_name: name } });
      if (error || !data.user) throw new Error(`Supabase owner password rotation failed: ${error?.code ?? "AUTH_ERROR"}`);
      authUser = data.user;
    }
    await client.query(
      `update users
       set supabase_user_id = $1, auth_linked_at = now(), email_verified_at = coalesce(email_verified_at, now()),
           password_hash = null, updated_at = now()
       where id = $2`,
      [authUser.id, userId],
    );
  }

  console.log(JSON.stringify({ level: "info", event: "owner.bootstrap.completed", email, organizationId }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
