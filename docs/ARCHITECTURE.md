# Moataz Agent Platform architecture

## Current production baseline

The repository currently uses a single deployable Next.js application. It contains the public UI, route handlers, the agent control plane, the synchronous agent runtime, and the Drizzle database layer. PostgreSQL is accessed through Neon's HTTP driver, which is compatible with Railway and serverless environments.

This structure is intentionally preserved during the first hardening phase. Moving immediately to a monorepo with separate web and API services would increase deployment and migration risk before authentication, tenancy enforcement, tests, and observability are complete.

## Target architecture

The migration will be incremental:

1. **Hardened modular application**: centralized configuration, health/readiness checks, security headers, CI, tests, standardized API responses, authentication, and RBAC.
2. **Domain packages**: extract shared validation, database, security, provider adapters, and UI primitives without changing public behavior.
3. **Worker boundary**: move long-running runs, webhook delivery, retries, and usage aggregation to a dedicated worker backed by Redis.
4. **Optional monorepo split**: expose `apps/web`, `apps/api`, and `apps/worker` only after their contracts and deployment topology are stable.

## Logical modules

- `src/app`: Next.js pages and route handlers.
- `src/db`: Drizzle schema and database connection.
- `src/lib/auth`: platform API-key authentication; user authentication will be added in phase 2.
- `src/lib/security`: AES-256-GCM credential encryption and API-key hashing.
- `src/lib/ai`: provider-neutral model gateway.
- `src/lib/agents`: agent execution orchestration and run persistence.
- `src/lib/config`: validated runtime configuration.

## Multi-tenancy boundary

Every tenant-owned record carries `organizationId`, directly or through a parent relation. API handlers must derive the organization from an authenticated principal and include it in every resource query. Client-provided organization identifiers are never trusted for authorization.

The initial platform API-key endpoints already scope provider credentials, agents, and runs by organization. User sessions, membership RBAC, explicit permission policies, and isolation tests are phase-2 work and must be completed before general user access is enabled.

## Secret handling

Provider credentials are encrypted with AES-256-GCM using a 32-byte master key loaded exclusively from `CREDENTIAL_ENCRYPTION_KEY`. Each encryption operation generates a unique 96-bit nonce and stores a versioned envelope containing nonce, authentication tag, and ciphertext. Provider keys are decrypted only inside the server runtime immediately before provider requests.

Platform API keys are shown once and persisted only as SHA-256 hashes. Comparisons use timing-safe equality.

## Availability

- `GET /api/health`: dependency-free liveness probe.
- `GET /api/ready`: database-backed readiness probe.
- Railway uses `/api/ready` so traffic is not sent to an instance that cannot reach PostgreSQL.

## Deployment rule

No migration is applied implicitly inside application startup. Database migrations are an explicit release step to avoid concurrent migration races across replicas. Railway deployment instructions must run migrations before promoting a new release that depends on schema changes.
