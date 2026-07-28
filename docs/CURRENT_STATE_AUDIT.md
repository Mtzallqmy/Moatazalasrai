# Current-state audit

Audit date: 2026-07-28

## What exists

- Next.js 16 application with TypeScript and Tailwind.
- PostgreSQL/Neon access through Drizzle ORM.
- Multi-tenant schema foundations for organizations, members, provider credentials, agents, versions, conversations, runs, events, API keys, and audit logs.
- Provider-neutral text generation adapters for OpenAI, Anthropic, and Gemini.
- AES-256-GCM provider credential encryption.
- Hashed platform API keys.
- Docker and Railway deployment configuration.

## Why the site currently behaves mainly as a presentation UI

The public landing page is implemented, while authenticated user-facing product flows are not. The current backend exposes platform bootstrap and API-key-protected JSON endpoints, but there is no user registration/login flow, session UI, dashboard shell, provider management UI, agent builder, playground, run explorer, or webhook UI.

## Critical gaps

1. No end-user authentication, password reset, email verification, or session revocation.
2. Membership roles exist in the schema but are not enforced through a reusable RBAC policy layer.
3. No browser-accessible dashboard connected to the existing backend.
4. Agent execution is synchronous and has no streaming, cancellation, queue, or worker isolation.
5. Provider adapters do not yet implement model listing, credential validation, tools, retries, or normalized cost accounting.
6. No webhook registration or delivery subsystem.
7. No usage records, estimated-cost ledger, or quota enforcement.
8. API responses are not yet standardized across all routes.
9. Existing audit logging covers only selected sensitive actions.
10. Automated coverage was limited and CI was absent.

## Phase-1 changes

This phase intentionally does not perform a high-risk monorepo rewrite. It establishes safety rails required before feature expansion:

- centralized runtime environment validation;
- dependency-free liveness and database-backed readiness probes;
- Railway readiness configuration;
- default security headers;
- encryption, hashing, and environment validation tests;
- CI for lint, typecheck, tests, and production build;
- architecture and deployment documentation.

## Migration decisions

- Keep the current single-service deployment until authentication and domain boundaries are stable.
- Preserve the current database schema and endpoints; extend them through additive migrations.
- Introduce authenticated user sessions before building dashboard pages.
- Introduce Redis only with the worker/webhook phase, avoiding an unused operational dependency.
- Use feature-complete pull requests with mandatory CI instead of one unreviewable rewrite.
