# Channel platform implementation plan

<!-- This document records the incremental, compatibility-preserving channel refactor. -->

## Existing architecture findings

- Telegram configuration is stored in the generic `integrations` table.
- Telegram webhook processing, conversation creation, attachment handling, commands, agent execution, and outgoing delivery are coupled in one route.
- WhatsApp Cloud API currently has platform credentials and a user-account linking flow, but no organization-owned channel connection model.
- Agent/provider/tool selection is not represented as a reusable channel routing policy.

## Target architecture

1. `ChannelAdapter` defines inbound normalization and outbound delivery capabilities.
2. `channel_connections` represents organization-owned Telegram or WhatsApp endpoints.
3. Bindings and policies select agents, providers, models, teams, inboxes, workflows, tools, commands, permissions, working hours, quotas, and handoff behavior.
4. `channel_contacts` and `channel_conversation_links` map external identities to internal users or guests and persist conversation continuity.
5. `routeIncomingChannelMessage` performs idempotency, policy checks, routing, conversation persistence, agent execution, permitted tool enforcement, handoff, delivery, and audit logging.
6. Legacy Telegram integrations are resolved through a compatibility bridge so existing bots continue working while management moves to the shared model.

No production database is changed directly; all schema changes are delivered through additive migrations.
