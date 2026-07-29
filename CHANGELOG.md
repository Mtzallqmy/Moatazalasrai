# Changelog

## Unreleased

- Added an original eight-template agent library for task execution, app architecture, research, software engineering, GitHub review, data, documents, and operations.
- Added the `member` role for public users while preserving all existing owner/admin memberships; public registration now joins the designated platform organization without granting administrative access.
- Added per-user conversation ownership and member-scoped file access to prevent cross-member IDOR inside a shared organization.
- Restricted provider, integration, membership, audit, diagnostics, and organization administration to privileged roles in both navigation and server handlers.
- Refreshed dashboard navigation, visual tokens, agent catalog, conversation list, message surfaces, composer, and responsive mobile menu.

- Added an opt-in agent-platform expansion: framework-neutral runtime contracts, allowlisted tools with persisted approvals, tenant/user-scoped memory, knowledge ingestion and citations, atomic background jobs, a separate Railway Worker, and redacted telemetry.
- Added a calmer visual identity and variable-driven light/dark design system across the shell, navigation, controls, cards, and landing page.
- Fixed chat attachments end-to-end: persisted files now reappear on message history with processing/download state, indexed document text is sent to agents, and supported images are delivered as native multimodal inputs across OpenAI, Anthropic, Gemini, OpenAI-compatible, API v1, and Telegram.

- Added production attachment persistence, signature validation, safe ZIP/Office extraction, content indexing, archive limits, and attachment lifecycle APIs.
- Added message editing/deletion, conversation folders, soft deletion/restoration, model-per-message tracking, and idempotent chat submissions.
- Added a discovered-model catalog and capability-aware model router with free-tier, defaults, provider health, and latency scoring.
- Added dashboard model switching and expanded multi-file upload support with accurate processing states.

## Unreleased

- نظام أخطاء آمن ثنائي اللغة مع retryability وإجراء مقترح.
- Integration Registry موحد لـTelegram وGitHub.
- Design tokens هادئة للوضعين الفاتح والداكن.
- صفحة ملفات فعلية مرتبطة بالتنزيل والمحادثات.
- بحث المحادثات ومسودة محلية لكل محادثة وإرسال Enter ونسخ الرسائل.
- تدقيق إنتاجي وسياسة ترقيات وDependabot محافظ ووثائق تشغيل موسعة.
