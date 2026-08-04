import { createHash, randomBytes, randomUUID, scrypt } from "node:crypto";
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

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
const bootstrapToken = process.env.BOOTSTRAP_ADMIN_TOKEN?.trim();
const expiryValue = process.env.BOOTSTRAP_ADMIN_TOKEN_EXPIRES_AT?.trim();

if (!email || !password) {
  console.log(JSON.stringify({
    level: "info",
    event: "owner.bootstrap.skipped",
    reason: "OWNER_EMAIL or OWNER_INITIAL_PASSWORD is not configured",
  }));
  process.exit(0);
}
if (!bootstrapToken || bootstrapToken.length < 32) {
  throw new Error("BOOTSTRAP_ADMIN_TOKEN must contain at least 32 characters.");
}
if (!expiryValue) throw new Error("BOOTSTRAP_ADMIN_TOKEN_EXPIRES_AT is required.");
const configuredExpiry = new Date(expiryValue);
if (!Number.isFinite(configuredExpiry.getTime()) || configuredExpiry <= new Date()) {
  throw new Error("BOOTSTRAP_ADMIN_TOKEN_EXPIRES_AT must be a future ISO-8601 timestamp.");
}

const tokenHash = digest(bootstrapToken);
const requestId = `cli-${randomUUID()}`;
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 20_000,
});
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO bootstrap_admin_tokens (id, token_hash, expires_at)
     VALUES ('admin', $1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [tokenHash, configuredExpiry],
  );
  const stateResult = await client.query(
    `SELECT token_hash, expires_at, used_at, disabled_at, permanently_disabled
     FROM bootstrap_admin_tokens
     WHERE id = 'admin'
     FOR UPDATE`,
  );
  const state = stateResult.rows[0];
  if (!state) throw new Error("Bootstrap control row is missing. Apply migrations first.");
  if (state.permanently_disabled || state.disabled_at) throw new Error("Bootstrap is permanently disabled.");
  if (state.used_at) throw new Error("Bootstrap token was already used.");
  if (state.token_hash !== tokenHash) throw new Error("Bootstrap token rotation is not allowed after initialization.");
  if (!state.expires_at || new Date(state.expires_at) <= new Date()) throw new Error("Bootstrap token is expired.");

  const existingUsers = await client.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [email]);
  if (existingUsers.rows[0]) {
    throw new Error("OWNER_EMAIL already exists; the bootstrap CLI will not mutate an existing identity.");
  }

  const passwordHash = await hashPassword(password);
  const insertedUser = await client.query(
    `INSERT INTO users (email, name, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [email, name, passwordHash],
  );
  const userId = insertedUser.rows[0]?.id;
  if (!userId) throw new Error("Owner user could not be created.");

  const slug = `moataz-${randomBytes(4).toString("hex")}`;
  const insertedOrganization = await client.query(
    `INSERT INTO organizations (name, slug)
     VALUES ($1, $2)
     RETURNING id`,
    [organizationName, slug],
  );
  const organizationId = insertedOrganization.rows[0]?.id;
  if (!organizationId) throw new Error("Owner organization could not be created.");

  await client.query(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [organizationId, userId],
  );
  await client.query(
    `UPDATE bootstrap_admin_tokens SET
       used_at = now(),
       used_request_id = $1,
       used_ip_hash = $2,
       updated_at = now()
     WHERE id = 'admin'`,
    [requestId, digest("local-cli")],
  );
  await client.query(
    `INSERT INTO audit_logs (
       organization_id, actor_type, actor_id, action, resource_type, resource_id, metadata
     ) VALUES (
       $1, 'bootstrap', $2, 'owner.bootstrapped', 'user', $2,
       jsonb_build_object('requestId', $3, 'source', 'cli', 'mfaEnrollmentRequired', true)
     )`,
    [organizationId, String(userId), requestId],
  );
  await client.query("COMMIT");

  console.log(JSON.stringify({
    level: "info",
    event: "owner.bootstrap.completed",
    email,
    organizationId,
    requestId,
    securityAction: "Enable TOTP MFA, remove bootstrap secrets, then run npm run bootstrap:disable.",
  }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
