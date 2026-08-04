# Production UI rebuild — implementation report

Date: 2026-08-03
Branch: `feature/production-ui-rebuild`

## Architecture discovered

- **Frontend:** Next.js 16 App Router, React 19, TypeScript, Server Components for page composition and Client Components only for interactive workspaces.
- **Backend:** Route Handlers under `src/app/api`, persisted agent runtime, SSE chat streaming, Graphile Worker jobs, official provider adapters, storage and integration services.
- **Database:** PostgreSQL with Drizzle ORM and ordered SQL migrations in `drizzle/`.
- **Authentication:** HttpOnly cookie sessions, active organization selection, organization RBAC, same-origin checks for cookie-authenticated mutations, PostgreSQL rate limiting, and audit logs.
- **State/data:** server-rendered initial data plus a shared typed API client for rebuilt client surfaces. No React Query dependency exists in the current package graph.
- **Design:** Arabic-first RTL, Alexandria variable font, global CSS tokens, responsive dashboard shell, light/dark appearance, keyboard focus and reduced-motion rules.
- **Tests:** Vitest unit/PostgreSQL integration suites and Playwright workflows.

## Page and backend inventory

| Page | Route | Real data/API | Required permission |
|---|---|---|---|
| Dashboard | `/dashboard` | Drizzle summaries, accessible runs | authenticated organization member |
| Chat | `/dashboard/chat` | `/api/dashboard/chat`, `/stream`, `/draft`, `/members`, `/messages`, `/runs` | `agents:run`; conversation ACL for each resource |
| Agents | `/dashboard/agents` | `/api/dashboard/agents`, provider/model catalog | `agents:read`; management actions require `agents:manage` |
| Runs | `/dashboard/runs` | `/api/dashboard/runs`, persisted run events | `runs:read`; conversation ACL |
| Files | `/dashboard/files` | `/api/dashboard/files`, database/local/R2 storage | `files:read`; upload/manage permissions for mutations |
| Knowledge | `/dashboard/knowledge` | knowledge-base, file and worker-backed ingestion APIs | feature flag plus authenticated organization access |
| Repositories | `/dashboard/repositories` | `/api/dashboard/repositories`, encrypted GitHub integration | `integrations:read` |
| Providers | `/dashboard/providers` | provider catalog, validation and verified-save APIs | provider read/manage permissions |
| Integrations | `/dashboard/integrations` | persisted integrations and connection tests | integration read/manage permissions |
| Members | `/dashboard/members` | organization membership APIs | members read/manage permissions |
| Approvals | `/dashboard/approvals` | persisted approval requests and decisions | approval policy enforced in server routes |
| Settings | `/dashboard/settings` | account settings and official WhatsApp Cloud API connection | authenticated user; management endpoints enforce CSRF/rate limits |

## Implemented UI foundation

- Unified spacing, typography, radius, color, focus, alert, status, skeleton, empty-state, button, field, select and card primitives.
- Responsive application shell with desktop sidebar, mobile drawer, safe-area bottom navigation, overflow protection and reduced-motion support.
- Navigation grouped around workspace, AI resources, operations and administration without exposing routes the current role cannot use.
- Typed API client with cookie credentials, request IDs, timeout/abort support, JSON envelope parsing and normalized 401/403/404/409/422/429/5xx/network errors.
- Deterministic query-key helpers and a client-safe permission policy shared with server authorization.

## Chat and conversation implementation

- Conversations and messages remain persisted in PostgreSQL and loaded from the existing dashboard API.
- Streaming remains the real SSE route; stop uses `AbortController` and the persisted run cancellation route.
- Drafts moved from `localStorage` to `conversation_drafts`, scoped by organization, conversation and user.
- Conversation membership is persisted in `conversation_members` with `reader`, `writer` and `manager` roles.
- The creator is backfilled and retained as manager; one user has one membership per conversation.
- Read, write and management checks are enforced server-side for conversation listing, messages, streaming, drafts, members, files, Puter and run inspection/cancellation.
- `messages.author_user_id` records the human author; the UI displays the sender for shared conversations.
- Readers receive a read-only composer. Writers can send and manage their own messages. Managers can manage membership and conversation metadata.
- Presence/activity indicators were not fabricated because no WebSocket/SSE presence service or presence table exists.
- Agent/model selection changes real execution inputs. Image attachments are blocked client-side for an explicitly selected non-Vision model, while server capability routing remains authoritative.
- Optional knowledge-base context and memory flags are sent to the actual RAG/memory paths only when those feature flags are enabled.
- Message rendering supports safe paragraphs, lists, code blocks, inline code and `http/https` links without `dangerouslySetInnerHTML`.

## Agents, models and runs

- Agent management uses the existing immutable version model, current version, publish/archive states, provider credential and model configuration.
- The editor is divided into identity, instructions, model/generation settings and version history instead of one unstructured form.
- Unsupported identity fields, rollback endpoints and fake test runs were not added. Restoring an old version creates a new immutable version through the existing API contract.
- The model picker is populated from the real model/provider endpoint and displays declared capabilities and health-derived availability.
- Runs display persisted status, model, token/latency data when present, safe event payloads and conversation links. Members only see runs for conversations they can read.

## Files, knowledge and repositories

- File upload uses the existing persistent storage abstraction with multi-file selection, real XHR progress, cancel/retry, size/type validation, archive/delete and protected preview/download.
- A member can read a file uploaded by another member only when it belongs to a conversation that member can read.
- Image/PDF previews are served by the authenticated file route with `nosniff` and private no-store headers.
- Knowledge screens use actual knowledge-base/document/worker states. They do not load extracted document text into browser state.
- GitHub repository browsing decrypts the integration token only on the server, lists repositories lazily, browses paths and previews bounded file content.
- Repository-wide indexing, checkpoints, background synchronization and source-line citations were not presented as implemented because the current schema has no complete job/checkpoint contract for them.

## Database migrations

- `0029_conversation_drafts.sql`: server-persisted per-user conversation drafts.
- `0030_conversation_members.sql`: conversation ACL enum/table/indexes, creator backfill, `messages.author_user_id`, and author index/backfill.
- The prior WhatsApp implementation remains in `0028_whatsapp_business_platform.sql`.

## Explicit gaps not represented as working UI

The current backend still lacks complete production contracts for:

- live presence/typing indicators;
- conversation forking and public/guest sharing;
- repository background indexing, commit checkpoints and line-level indexed citations;
- URL knowledge sources and knowledge-base deletion/versioning;
- file version history;
- rich per-agent avatar/color/personality schema beyond existing agent/version fields;
- notification delivery and general automation scheduling pages;
- password recovery/email verification until a real mail provider is configured.

These require additive schemas, jobs, authorization rules, APIs, migrations and integration tests before enabling controls.

## Verification record

Commands actually executed on 2026-08-03:

| Command/check | Actual result |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | **Failed before installation**: the configured internal registry returned HTTP 404 for `zod-validation-error@4.0.2`. Node also reported 22.16.0 while the repository requires 22.18.0. |
| `npm run typecheck` | **Executed but not a valid project typecheck**: installation had failed, so TypeScript reported missing project dependencies and Node/React test types. |
| `npm run lint` | **Failed before linting**: local `eslint` binary was unavailable because dependencies were not installed. |
| `npm test -- --runInBand` | **Failed before tests**: local `vitest` binary was unavailable. |
| `npm run test:integration` | **Failed before tests**: local `vitest` binary was unavailable; no `TEST_DATABASE_URL` was supplied. |
| `npm run test:e2e` | **Failed before project E2E**: the local Playwright package was unavailable. |
| `npm run build` | **Failed before build**: local `next` binary was unavailable. |
| `git diff --check 0b8667b..HEAD` | **Passed**. |
| Global TypeScript syntax transpilation | **Passed for 64 changed `.ts`/`.tsx` files**. This validates syntax only, not full project typing. |
| SQL parser | **Passed**: migrations 0027/0028/0029/0030 parsed into 21/11/3/9 statements. |
| YAML parser | **Passed for 3 changed workflow files**. |
| `bash -n` | **Passed for changed shell scripts**. |

No live provider, GitHub mutation, storage, WhatsApp, Meta message or Railway deployment was executed without credentials. GitHub publication was attempted separately but the session connector was disabled and direct Git access failed DNS resolution; no remote upload or PR creation is claimed.
