import { randomBytes, scrypt } from "node:crypto";
import pg from "pg";

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
  if (password.length < 10 || password.length > 128) {
    throw new Error("OWNER_INITIAL_PASSWORD must contain 10 to 128 characters.");
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
  } else if (!existingUsers.rows[0]?.password_hash) {
    const passwordHash = await hashPassword(password);
    await client.query(
      "update users set password_hash = $1, name = coalesce(name, $2), updated_at = now() where id = $3",
      [passwordHash, name, userId],
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
      "update organization_members set role = 'owner' where organization_id = $1 and user_id = $2",
      [organizationId, userId],
    );
  }

  await client.query(
    `insert into audit_logs (organization_id, actor_type, actor_id, action, resource_type, resource_id, metadata)
     values ($1, 'bootstrap', $2, 'owner.bootstrap.verified', 'user', $3, '{}'::jsonb)`,
    [organizationId, String(userId), String(userId)],
  );
  await client.query("COMMIT");

  console.log(JSON.stringify({ level: "info", event: "owner.bootstrap.completed", email, organizationId }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
