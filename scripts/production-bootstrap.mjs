import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required before production bootstrap.");

const sql = neon(databaseUrl);

const statements = [
  `create extension if not exists pgcrypto`,
  `do $$ begin create type member_role as enum ('owner','admin','developer','operator','viewer'); exception when duplicate_object then null; end $$`,
  `do $$ begin create type agent_status as enum ('draft','published','archived'); exception when duplicate_object then null; end $$`,
  `do $$ begin create type run_status as enum ('queued','running','waiting_for_approval','completed','failed','cancelled'); exception when duplicate_object then null; end $$`,
  `do $$ begin create type provider_kind as enum ('openai','anthropic','gemini'); exception when duplicate_object then null; end $$`,
  `create table if not exists organizations (
    id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  )`,
  `create table if not exists users (
    id uuid primary key default gen_random_uuid(), email text not null unique, name text,
    password_hash text, email_verified_at timestamptz,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  )`,
  `alter table users add column if not exists password_hash text`,
  `alter table users add column if not exists email_verified_at timestamptz`,
  `create table if not exists sessions (
    id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade,
    token_hash text not null unique, expires_at timestamptz not null, last_seen_at timestamptz not null default now(),
    ip_address text, user_agent text, revoked_at timestamptz, created_at timestamptz not null default now()
  )`,
  `create index if not exists sessions_user_id_idx on sessions(user_id)`,
  `create index if not exists sessions_expires_at_idx on sessions(expires_at)`,
  `create table if not exists organization_members (
    id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
    user_id uuid not null references users(id) on delete cascade, role member_role not null default 'viewer',
    created_at timestamptz not null default now(), unique(organization_id,user_id)
  )`,
  `create index if not exists organization_members_user_idx on organization_members(user_id)`,
  `create table if not exists platform_api_keys (
    id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
    name text not null, key_hash text not null unique, key_prefix text not null, revoked boolean not null default false,
    last_used_at timestamptz, created_at timestamptz not null default now()
  )`,
  `create table if not exists provider_credentials (
    id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
    provider provider_kind not null, name text not null, encrypted_secret text not null, secret_hint text not null,
    enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  )`,
  `create table if not exists agents (
    id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
    name text not null, description text, status agent_status not null default 'draft', current_version integer not null default 1,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  )`,
  `create table if not exists agent_versions (
    id uuid primary key default gen_random_uuid(), agent_id uuid not null references agents(id) on delete cascade,
    version integer not null, provider_credential_id uuid not null references provider_credentials(id), model text not null,
    instructions text not null, temperature_milli integer not null default 200, max_output_tokens integer not null default 2048,
    max_model_calls integer not null default 8, max_tool_calls integer not null default 12, tools jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(), unique(agent_id,version)
  )`,
  `create table if not exists conversations (
    id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
    agent_id uuid not null references agents(id) on delete cascade, title text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  )`,
  `create table if not exists messages (
    id uuid primary key default gen_random_uuid(), conversation_id uuid not null references conversations(id) on delete cascade,
    role text not null, content text not null, metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists runs (
    id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
    agent_id uuid not null references agents(id), agent_version_id uuid not null references agent_versions(id),
    conversation_id uuid references conversations(id), status run_status not null default 'queued', input text not null,
    output text, error text, provider provider_kind not null, model text not null, input_tokens integer not null default 0,
    output_tokens integer not null default 0, started_at timestamptz, completed_at timestamptz,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists run_events (
    id uuid primary key default gen_random_uuid(), run_id uuid not null references runs(id) on delete cascade,
    sequence integer not null, type text not null, payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists audit_logs (
    id uuid primary key default gen_random_uuid(), organization_id uuid references organizations(id) on delete cascade,
    actor_type text not null, actor_id text, action text not null, resource_type text not null, resource_id text,
    metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
  )`
];

for (const statement of statements) {
  await sql.query(statement, []);
}

function derivePassword(password) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scryptCallback(password, salt, 64, (error, derived) => {
      if (error) reject(error);
      else resolve(`scrypt.${salt.toString("base64url")}.${derived.toString("base64url")}`);
    });
  });
}

const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
const ownerPassword = process.env.OWNER_INITIAL_PASSWORD;
const ownerName = process.env.OWNER_NAME?.trim() || "معتز العلقمي";
const organizationName = process.env.OWNER_ORGANIZATION_NAME?.trim() || "Moataz Agent Platform";

if (ownerEmail && ownerPassword) {
  if (ownerPassword.length < 10 || ownerPassword.length > 128) {
    throw new Error("OWNER_INITIAL_PASSWORD must contain between 10 and 128 characters.");
  }

  const existing = await sql.query(`select id from users where email = $1 limit 1`, [ownerEmail]);
  let userId = existing[0]?.id;

  if (!userId) {
    const passwordHash = await derivePassword(ownerPassword);
    const createdUsers = await sql.query(
      `insert into users (email,name,password_hash,email_verified_at) values ($1,$2,$3,now()) returning id`,
      [ownerEmail, ownerName, passwordHash]
    );
    userId = createdUsers[0].id;
  }

  const membership = await sql.query(
    `select organization_id from organization_members where user_id = $1 and role = 'owner' limit 1`,
    [userId]
  );

  if (!membership[0]) {
    const slug = `moataz-${randomBytes(4).toString("hex")}`;
    const organizations = await sql.query(
      `insert into organizations (name,slug) values ($1,$2) returning id`,
      [organizationName, slug]
    );
    const organizationId = organizations[0].id;
    await sql.query(
      `insert into organization_members (organization_id,user_id,role) values ($1,$2,'owner') on conflict do nothing`,
      [organizationId, userId]
    );
    await sql.query(
      `insert into audit_logs (organization_id,actor_type,actor_id,action,resource_type,resource_id,metadata) values ($1,'bootstrap',$2,'owner.bootstrap','user',$2,'{}'::jsonb)`,
      [organizationId, userId]
    );
  }
}

console.log(JSON.stringify({ level: "info", event: "production_bootstrap_complete", ownerConfigured: Boolean(ownerEmail && ownerPassword) }));
