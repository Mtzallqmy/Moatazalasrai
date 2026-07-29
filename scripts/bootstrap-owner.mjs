import { randomBytes, scrypt } from "node:crypto";
import postgres from "postgres";

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

const sql = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 10,
  idle_timeout: 20,
  prepare: false,
});

try {
  const existingUsers = await sql`select id, password_hash from users where email = ${email} limit 1`;
  let userId = existingUsers[0]?.id;

  if (!userId) {
    const passwordHash = await hashPassword(password);
    const inserted = await sql`
      insert into users (email, name, password_hash)
      values (${email}, ${name}, ${passwordHash})
      returning id
    `;
    userId = inserted[0]?.id;
    if (!userId) throw new Error("Owner user could not be created.");
  } else if (!existingUsers[0]?.password_hash) {
    const passwordHash = await hashPassword(password);
    await sql`update users set password_hash = ${passwordHash}, name = coalesce(name, ${name}), updated_at = now() where id = ${userId}`;
  }

  const memberships = await sql`
    select organization_id from organization_members where user_id = ${userId} order by created_at asc limit 1
  `;
  let organizationId = memberships[0]?.organization_id;

  if (!organizationId) {
    const slug = `moataz-${randomBytes(4).toString("hex")}`;
    const insertedOrganizations = await sql`
      insert into organizations (name, slug)
      values (${organizationName}, ${slug})
      returning id
    `;
    organizationId = insertedOrganizations[0]?.id;
    if (!organizationId) throw new Error("Owner organization could not be created.");
    await sql`
      insert into organization_members (organization_id, user_id, role)
      values (${organizationId}, ${userId}, 'owner')
      on conflict (organization_id, user_id) do update set role = 'owner'
    `;
  } else {
    await sql`
      update organization_members set role = 'owner'
      where organization_id = ${organizationId} and user_id = ${userId}
    `;
  }

  await sql`
    insert into audit_logs (organization_id, actor_type, actor_id, action, resource_type, resource_id, metadata)
    values (${organizationId}, 'bootstrap', ${String(userId)}, 'owner.bootstrap.verified', 'user', ${String(userId)}, '{}'::jsonb)
  `;

  console.log(JSON.stringify({ level: "info", event: "owner.bootstrap.completed", email, organizationId }));
} finally {
  await sql.end({ timeout: 5 });
}
