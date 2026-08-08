# Phase 2 — Operational AI Tools foundation

## Gate

Phase 2 starts only after the shared Execution Kernel is merged and green. The foundation consumes `execution_jobs`, `execution_workspaces`, `execution_steps`, `execution_events`, `execution_artifacts`, `execution_usage`, the shared runner contract, Artifact Registry, Credential Broker, cancellation/timeout, SSE, deny-by-default networking, cleanup and reconciliation. It does not create a second execution substrate.

## External architecture references reviewed

- OpenHands SDK: keep Agent orchestration separate from Workspace execution; use typed append-only events, interruptible steps, pause/resume and remote isolated workspaces as optional adapter guidance.
- Aider: use a repository map rather than sending the full repository, and run lint/tests after edits. Aider may be an optional coding engine only inside the isolated Execution Workspace.
- GitHub Spec Kit: preserve Specify → Plan → Tasks → Implement, followed by consistency/convergence verification. The platform stores these as artifacts and does not require the external CLI.
- Playwright: primary Browser Agent engine with isolated contexts, downloads, screenshots and traces.
- Stagehand: optional discovery helper over a Playwright page for unknown interfaces. Discovered actions must be converted into validated deterministic Playwright steps for replay.
- OpenAI Audio and ElevenLabs: provider adapters invoked by the platform provider layer, never by a browser runner. Voice names/capabilities are discovered from the real provider and are not hard-coded as claims.
- FFmpeg: media conversion/merge/normalization belongs in the isolated media/sandbox execution path.

## Foundation delivered by this change

- `tool_runs` with a unique organization + Execution Job link.
- `tool_run_messages`, `tool_run_inputs`, `tool_run_approvals`.
- `data_interpreter_sessions`, `coding_projects`, `coding_agent_runs`, `browser_agent_sessions`, `voice_generation_jobs`.
- Four versioned manifests: `data.interpreter`, `coding.agent`, `browser.agent`, `voice.studio`.
- RBAC permissions for common tools plus tool-specific write/publish/profile management permissions.
- Fail-closed availability: global runtime flag, per-tool environment flag, organization module, organization feature flag, permission, applied migrations, healthy runner/provider.
- Tool Run completion guard: the linked Execution Job must be completed; verification must pass; and either a non-empty structured result or at least one Execution Artifact must exist.
- Existing `/api/tools` output is preserved and operational tools are appended only when genuinely ready.

## Feature flags and runtime defaults

All remain disabled until the matching real implementation is healthy:

```text
TOOLS_RUNTIME_ENABLED=false
DATA_INTERPRETER_ENABLED=false
DATA_INTERPRETER_TEMPLATE_ID=python-data-v1
DATA_INTERPRETER_MAX_REPAIR_ATTEMPTS=3
DATA_INTERPRETER_MAX_DATASET_BYTES=104857600
DATA_INTERPRETER_MAX_ROWS_PREVIEW=100
CODING_AGENT_ENABLED=false
CODING_AGENT_ENGINE=internal
CODING_AGENT_TEMPLATE_ID=coding-node-python-v1
CODING_AGENT_MAX_STEPS=40
CODING_AGENT_MAX_REPAIR_ATTEMPTS=5
CODING_AGENT_ALLOW_PULL_REQUESTS=false
OPENHANDS_AGENT_ENABLED=false
AIDER_AGENT_ENABLED=false
BROWSER_AGENT_ENABLED=false
BROWSER_AGENT_ENGINE=playwright
BROWSER_AGENT_ALLOW_STAGEHAND=false
BROWSER_AGENT_MAX_STEPS=50
BROWSER_AGENT_SESSION_TTL_SECONDS=1800
BROWSER_AGENT_TRACE_ENABLED=true
VOICE_STUDIO_ENABLED=false
VOICE_PREVIEW_MAX_CHARACTERS=500
VOICE_FINAL_MAX_CHARACTERS=50000
VOICE_MAX_CHUNKS=100
VOICE_FFMPEG_ENABLED=true
OPENAI_VOICE_PROVIDER_ENABLED=false
ELEVENLABS_VOICE_PROVIDER_ENABLED=false
```

## Deliberately not enabled in this foundation

No Data Interpreter Python execution, coding engine, browser action, speech generation, channel command, commit, pull request, or external write is enabled by this change. Those are separate implementation slices and must pass their own PostgreSQL/runner/acceptance gates before their feature flags can be enabled.
