# AI Workspace Product Audit

Date: 2026-08-08
Scope: production web workspace, API routes, database-backed state, streaming, uploads, agents, runs, integrations, MCP, Sandbox, RTL and responsive navigation.

## Product/data-flow findings

### Real production data already available
- Dashboard metrics, agents, runs, conversations, messages, attachments, knowledge bases, providers, MCP catalog, tool calls and integration health are database-backed.
- Conversations already support rename, pin, archive, restore, soft-delete and folders in the existing API/schema. The redesign must reuse these paths instead of creating duplicate endpoints.
- Runs already persist status, provider/model, usage, events and errors. Status values must remain internal English enum values and be localized only at the presentation boundary.
- Chat streaming is real SSE and supports cancellation. The redesign must preserve the existing stream transport and AbortController stop path.
- File upload and indexing are real. Archive validation can reject a ZIP before a durable attachment exists; the UI must therefore own a transient pre-upload state but reconcile durable state from the backend response.
- MCP execution is a real remote MCP SDK transport with persisted servers/tools/resources/prompts, tool limits, approvals, idempotency and run/audit events.
- Telegram and WhatsApp channel delivery are durable worker-backed after PR #94.

### Production UI that is not aligned with the backend
- The global search command palette only searches navigation labels in frontend memory although searchable entities already exist in the database.
- Chat upload state is represented by a global uploading boolean plus a failed list. This permits contradictory visual states such as a failed archive still appearing as uploading.
- Message response metadata exposes model/provider-like technical information, latency and token values directly in the normal conversation flow.
- The conversation page loads a large fixed batch and does not provide an explicit older-message pagination interaction that preserves scroll position.
- Sandbox is mounted as a floating conversation dock and can cover the composer/bottom navigation despite being an advanced/developer capability.
- Mobile bottom navigation derives the first five items marked `mobile`, which makes information architecture dependent on array order and gives channels equal primary weight to conversations/runs.
- The mobile header exposes theme as a primary icon even though it belongs in secondary/account controls.
- Agent list cards expose lifecycle/version/model details and too many actions at the same visual weight.
- Run filters expose internal English status values and wrap poorly on narrow screens.

### Database/query findings
- Existing indexes already cover the requested high-frequency relationships: conversations by organization/update/archive, messages by conversation/created time, runs by organization/status/created time and agent/conversation, attachments by conversation/created time. No speculative duplicate index migration is required for the first redesign phases.
- Tenant authorization is enforced server-side and strengthened by PostgreSQL RLS from PR #94. New search/detail APIs must still use existing permission checks and tenant context rather than relying on UI filtering.
- Dashboard and entity pages contain several independent queries. They are real, but some presentation components request more fields than needed for compact list views. The redesign should narrow select projections and paginate lists rather than introduce mock caches.

## Responsive and RTL findings
- `overflow-wrap:anywhere` is applied to normal chat message content, which can produce undesirable Arabic wrapping. Arabic prose needs normal word breaking; only technical identifiers should use aggressive wrapping.
- Several technical surfaces use `break-all`; model slugs, IDs and URLs should instead be isolated LTR values with `unicode-bidi:isolate` and safe wrapping.
- Mobile icon controls are about 39px in several places, below the 44px touch target requirement.
- Bottom navigation labels use a very small font and ellipsis; the primary navigation needs exactly five short labels.
- Fixed navigation and the floating Sandbox dock compete for bottom screen space. The Sandbox trigger must move into progressive disclosure.

## Loading / error / empty findings
- Shared primitives exist, but pages use them inconsistently. Some lists conflate an API failure with an empty result and some controls use inline success/error panels for transient events that should be toasts/status messages.
- Upload status vocabulary differs between transient client upload state and backend intelligence/indexing state. A single UI state machine is required.

## Architecture decision

The redesign will preserve current routes and backend capabilities and introduce redirects/aliases only when a clearer route is added. It will not rewrite the app, add a large UI framework, store server truth in localStorage, or invent runtime statuses that do not exist.

### PHASE 1 — Critical UX + responsive fixes
- Normalize design tokens, touch targets, RTL/LTR utilities and shared presentation helpers.
- Replace mobile primary navigation with: الرئيسية، المحادثات، الوكلاء، التشغيلات، المزيد.
- Move secondary navigation into an accessible mobile bottom sheet/drawer.
- Clean the header and move theme/profile controls out of the primary mobile header.
- Remove the floating Sandbox overlap and expose it through advanced tools/permissions.
- Replace frontend-only navigation search with tenant-scoped grouped global search.

### PHASE 2 — Navigation + conversations
- Compact grouped conversation hub using existing pin/archive/folder APIs.
- Progressive message technical details and compact message actions.
- Simplified composer with advanced Tools/Context disclosure.
- Per-file upload state machine and backend reconciliation.
- Older-message pagination, near-bottom auto-scroll and “latest message” affordance.

### PHASE 3 — Agents + Runs
- Compact agent list, action menu, friendly model names and advanced settings disclosure.
- Localized run filters backed by URL query params, compact run rows/cards and useful timeline/detail presentation.

### PHASE 4 — Backend state integration
- Real grouped global search API and lean dashboard summary where existing queries cannot be reused safely.
- Narrow list projections, pagination and consistent status contracts.
- Preserve server-side permission/tenant checks for every entity lookup.

### PHASE 5 — Polish + testing
- Responsive checks for 320/360/390/412/430/768/1024/1440 widths.
- RTL/mixed-direction and accessibility regression tests.
- Playwright screenshots where the authenticated test harness permits deterministic setup.
- Final lint, typecheck, unit/integration tests and production build.
