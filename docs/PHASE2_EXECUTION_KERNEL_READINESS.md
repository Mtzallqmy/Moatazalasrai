# Phase 2 — Execution Kernel Readiness Audit

Date: 2026-08-07
Repository: `Mtzallqmy/Moatazalasrai`
Audited branch: `main`
Audited head at start: `c33056eb21b74741e8b4ae8d145621f72b8041c0`

## Decision

**BLOCKED — do not enable or implement Operational AI Tools yet.**

The repository contains mature *specialized* Sandbox, Browser, Agent Runtime, approvals, artifacts, events and Graphile Worker components, but it does not yet contain the shared Execution Kernel contract required by Phase 2.

No `data.interpreter`, `coding.agent`, `browser.agent`, or `voice.studio` Tool Manifest/API/UI should be added until this document reaches READY and `npm run execution:kernel:check` exits successfully.

## Automated gate

Run:

```bash
npm run execution:kernel:check
```

The command must exit `0` before Phase 2 tools are enabled. A non-zero exit is a deliberate hard block, not a warning.

## Required kernel matrix

| Requirement | Status | Current repository evidence / gap |
| --- | --- | --- |
| `execution_jobs` | Missing | Current orchestration uses `agent_tasks`; Sandbox uses `sandbox_executions`. Neither is the shared kernel table. |
| `execution_workspaces` | Missing | Current isolated workspaces are `sandbox_workspaces`; no tool-agnostic workspace table exists. |
| `execution_steps` | Missing | There are `agent_task_steps`, `agent_run_steps`, browser steps and other specialized steps only. |
| `execution_events` | Missing | There are `sandbox_events`, `run_events`, channel events, etc., but no shared execution event stream. |
| `execution_artifacts` | Missing | There are `sandbox_artifacts` and `agent_task_artifacts`; there is no shared execution artifact registry/table. |
| `execution_usage` | Missing | There are per-runtime counters/limits, but no shared execution usage ledger. |
| Graphile Worker execution tasks | Missing | Worker registry has sandbox/browser/agent/channel tasks, but no generic execution run/resume/cancel/cleanup/reconcile tasks. |
| `ExecutionRunner` contract | Missing | No shared execution runner interface/abstract contract was found. |
| `ExistingSandboxAdapter` | Missing | Sandbox runner client/runtime exists, but no adapter exposes it behind `ExecutionRunner`. |
| Cancellation and timeout | Partial | Sandbox and browser have cancellation/timeout fields and logic, but the behavior is not owned by a shared execution lifecycle. |
| SSE live events | Partial | Sandbox has persisted SSE events; there is no SSE endpoint over shared `execution_events`. |
| Artifact Registry | Missing | Runtime-specific artifact services exist; no shared registry enforces all tool artifact invariants. |
| Credential Broker | Missing | Existing encrypted credentials/connectors are not exposed through an execution-scoped broker contract. |
| Network deny-by-default | Partial | Sandbox workspaces are created with network disabled, but there is no shared kernel network policy used by every runner. |
| Tenant isolation | Partial | Existing tables are organization-scoped, but the required shared execution tables do not exist yet. |
| Resource quotas | Partial | Sandbox has disk/concurrency/timeout/output controls and agent tasks have budgets; there is no shared execution quota/usage service. |
| Cleanup | Partial | Sandbox cleanup jobs exist. |
| Reconciliation | Missing | No shared execution reconciliation service/task was found. |

## Existing components to reuse, not duplicate

### Agent orchestration

`src/db/orchestration-schema.ts` already contains:

- `agent_tasks`
- `agent_task_steps`
- `agent_task_tool_calls`
- `agent_task_checkpoints`
- `agent_task_artifacts`

This is agent orchestration state. Phase 1 should either map it cleanly onto the Execution Kernel or keep it as a higher-level consumer of the kernel. Phase 2 must not create a second competing generic task runtime.

### Sandbox

The existing Sandbox stack already provides valuable implementation building blocks:

- `sandbox_workspaces`
- `sandbox_executions`
- `sandbox_events`
- `sandbox_files`
- `sandbox_artifacts`
- HMAC-authenticated isolated runner client
- network disabled on newly created workspaces
- disk limits, concurrency limits, timeout and output limits
- approvals and cancellation
- Graphile Worker tasks
- persisted SSE event delivery
- cleanup jobs

Phase 1 should wrap this behind `ExistingSandboxAdapter` rather than rewrite it.

### Browser

The existing browser runtime already owns browser tasks, cancellation and persisted runtime state. Phase 1 should adapt it to the same Execution Kernel rather than introducing a separate Phase 2 browser lifecycle.

### Graphile Worker

The worker registry currently contains real specialized tasks for agent runs, teams, document parsing, notifications, Telegram/WhatsApp, Sandbox and Browser. The missing piece is the generic Execution Kernel task layer that Phase 2 Tool Runs can depend on.

## Additional structural gap

`drizzle.config.ts` loads the specialized Sandbox, Browser and orchestration schemas for migration generation, but the central database readiness contract in `src/db/index.ts` has no `execution_*` tables and therefore cannot prove Phase 1 readiness at application startup.

The future Phase 1 completion should add the shared execution schema to both migration generation and runtime readiness verification.

## Minimum work required before Phase 2

1. Add additive Drizzle migrations and schema for:
   - `execution_jobs`
   - `execution_workspaces`
   - `execution_steps`
   - `execution_events`
   - `execution_artifacts`
   - `execution_usage`
2. Define `ExecutionRunner` with explicit create/execute/cancel/status/artifact lifecycle semantics.
3. Implement `ExistingSandboxAdapter` over the current Sandbox services/runners.
4. Implement a shared Artifact Registry that owns path safety, hashes, sizes, MIME, retention and object-storage registration.
5. Implement an execution-scoped Credential Broker that passes capabilities/references, never provider secrets, into runners.
6. Define shared network policy with `deny_all` default and explicit allowlists.
7. Define shared resource quotas and usage accounting.
8. Add generic Graphile Worker execution tasks with idempotency, leases/recovery and cancellation.
9. Add shared persisted SSE over `execution_events`.
10. Add Cleanup **and** Reconciliation for orphaned/expired jobs, workspaces and artifacts.
11. Add startup/database readiness verification for all kernel tables and worker tasks.
12. Add PostgreSQL integration tests for tenant isolation, idempotency, cancellation, timeout, artifacts, usage and reconciliation.
13. Make `npm run execution:kernel:check` pass in source and production schema checks.

## Phase 2 activation rule

Only after the kernel is complete may the project add:

- `data.interpreter`
- `coding.agent`
- `browser.agent`
- `voice.studio`
- `tool_runs` and related Phase 2 tables
- `/api/tools` and `/api/tool-runs/*`
- Phase 2 UI cards, Telegram capabilities or WhatsApp capabilities

Until then those features must remain absent rather than exposed as placeholders.

## External references

The OpenHands/Aider/Spec Kit/Playwright/Stagehand/Jupyter/data-stack/audio/FFmpeg design review belongs to Phase 2 implementation. It is intentionally deferred until the mandatory kernel gate passes, because selecting engine adapters before the execution contract exists would couple Phase 2 to runtime-specific implementations and violate the requested architecture.
