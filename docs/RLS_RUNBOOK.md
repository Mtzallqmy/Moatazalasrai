# PostgreSQL Row-Level Security Runbook

## Scope and inventory

The clean PostgreSQL 16 discovery is recorded in `docs/RLS_DISCOVERY.md`.

The exact requested query for a column named `org_id` returned zero rows because this repository uses the canonical column name `organization_id`. The clean schema contains 52 tables with `organization_id`; migration `0032_tenant_row_level_security.sql` discovers that set from `information_schema` and does not rely on a manually maintained table list.

RLS is also applied to tenant-derived tables that do not carry `organization_id` directly:

- `agent_versions` through `agents`
- `messages` through `conversations`
- `run_events` through `runs`
- `telegram_updates` through `integrations`
- `organizations` through the active organization or user membership
- `sessions`, `user_preferences`, and `whatsapp_link_tokens` through `user_id`

System-only tables, migration metadata, global rate-limit state, webhook replay records, and Graphile Worker internal tables are intentionally not tenant-filtered. Access to tenant data from trusted webhooks and maintenance code must use an explicit system context with a non-empty audit reason.

## Enforcement model

Migration `0032` creates a non-login role named `moataz_app_runtime` with `NOBYPASSRLS`, grants it only the required schema/table/sequence privileges, enables and forces RLS, and creates `USING` plus `WITH CHECK` policies.

Application connections are opened with the database owner configured in `DATABASE_URL`, immediately switch to `moataz_app_runtime`, and receive three connection-local settings from `AsyncLocalStorage`:

```text
app.current_organization_id
app.current_user_id
app.rls_bypass
```

A normal request gets tenant or user context after authentication. A background task receives tenant context from its `organizationId` payload. A task without a tenant payload is required to enter an explicit system context. Signed WhatsApp webhook processing uses an explicit system context because the tenant is resolved from trusted event data after signature verification.

A connection with no context fails closed. The only bypass is `app.rls_bypass = on`, which is set by an explicit system context or the test-only compatibility path.

## Pre-deployment checks

1. Confirm a current logical backup or provider snapshot exists.
2. Verify the production database login can create and grant a role. Run:

```sql
SELECT current_user,
       rolsuper,
       rolcreaterole,
       rolbypassrls
FROM pg_roles
WHERE rolname = current_user;
```

If `rolcreaterole` is false and the role does not already exist, create `moataz_app_runtime` through the database provider before migration, or grant the migration login permission to create it.

3. Confirm no unrelated migration named `0032_tenant_row_level_security.sql` has already been applied with another checksum.
4. Drain old application replicas or use a maintenance window. RLS is forced in the database; an old replica that does not switch to `moataz_app_runtime` and set context may fail after migration.
5. Deploy web and worker from the same commit. Do not deploy only one process.

## Deployment sequence

1. Stop new traffic or drain old replicas.
2. Run platform migrations:

```bash
npm run db:migrate
```

3. Run Graphile Worker migrations and grants:

```bash
npm run worker:migrate
```

4. Start web and worker from the same release.
5. Restore traffic only after `/api/ready` and the worker healthcheck pass.

## Required validation

Run these checks using the migration owner:

```sql
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns cols
    WHERE cols.table_schema = 'public'
      AND cols.table_name = c.relname
      AND cols.column_name = 'organization_id'
  )
ORDER BY c.relname;
```

Every returned row must show `true` for both flags.

Verify policy coverage:

```sql
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

Verify the runtime role cannot bypass RLS:

```sql
SELECT rolname, rolcanlogin, rolbypassrls
FROM pg_roles
WHERE rolname = 'moataz_app_runtime';
```

Expected values are `false` for `rolcanlogin` and `rolbypassrls`.

Verify Graphile grants:

```sql
SELECT
  has_schema_privilege('moataz_app_runtime', 'graphile_worker', 'USAGE'),
  has_table_privilege('moataz_app_runtime', 'graphile_worker._private_jobs', 'SELECT');
```

Both values must be true.

The CI integration suite also verifies:

- zero tenant rows are visible with no context;
- one tenant cannot read, update, or insert rows for another tenant;
- derived `messages` rows are filtered through `conversations`;
- user-only membership discovery is isolated;
- every `organization_id` table has a leading organization index;
- only explicit system bypass can read multiple tenants.

## Operational diagnostics

A PostgreSQL error code `42501` during a legitimate request usually means the request did not enter tenant context before its first tenant query. Check the authentication boundary and ensure the relevant call invokes one of:

```text
enterTenantDatabaseContext
enterUserDatabaseContext
runWithTenantDatabaseContext
runWithSystemDatabaseContext
```

Do not solve a missing context by adding a broad policy or setting a permanent bypass.

If Graphile Worker reports permission errors, rerun `npm run worker:migrate`; the Graphile schema does not exist when the platform migration is applied, so its grants are deliberately installed after Graphile migrations.

## Rollback

Rollback is provided at:

```text
drizzle/down/0032_tenant_row_level_security.sql
```

Run it with the database migration owner during a maintenance window:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f drizzle/down/0032_tenant_row_level_security.sql
```

The rollback:

- drops only policies assigned to the runtime role;
- disables and unforces RLS on affected public tables;
- removes only indexes created with the `rls_org_scope_` prefix;
- revokes public and Graphile privileges;
- removes the role after revoking membership;
- does not delete application rows or Graphile Worker data.

After rollback, redeploy the immediately preceding application release. Do not leave the RLS-aware application running without the runtime role.
