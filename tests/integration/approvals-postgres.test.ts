import { randomUUID } from "node:crypto";
import { createTestSqlClient, type Sql } from "../helpers/pg-sql";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("tool approval lifecycle on PostgreSQL", () => {
  let sql: Sql;
  const organizations = new Set<string>();

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl!;
    process.env.CREDENTIAL_ENCRYPTION_KEY ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    sql = createTestSqlClient(databaseUrl!, 3);
  });

  afterAll(async () => {
    for (const organizationId of organizations) {
      await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
    }
    await sql.end({ timeout: 5 });
  });

  async function createOrganization(name: string) {
    const organizationId = randomUUID();
    organizations.add(organizationId);
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, ${name}, ${`approval-${organizationId}`})`;
    return organizationId;
  }

  async function seedApprovalRuntime() {
    const organizationId = await createOrganization("Approval Integration");
    const userId = randomUUID();
    await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`approval-${userId}@example.test`}, 'Approver')`;
    await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${organizationId}, ${userId}, 'admin')`;

    const credentialId = randomUUID();
    await sql`
      INSERT INTO provider_credentials (
        id, organization_id, provider, provider_type_id, transport_mode, credential_mode, name, base_url, encrypted_secret,
        secret_hint, discovered_models, validation_status, enabled
      ) VALUES (
        ${credentialId}, ${organizationId}, 'openai', 'openai', 'direct', 'encrypted_byok', 'Approval Provider',
        'https://api.openai.com/v1', 'unused', 'test',
        ${sql.json(["test-model"])}, 'verified', true
      )
    `;
    const agentId = randomUUID();
    await sql`
      INSERT INTO agents (
        id, organization_id, name, status, current_version,
        default_provider_credential_id, default_model
      ) VALUES (
        ${agentId}, ${organizationId}, 'Approval Agent', 'published', 1,
        ${credentialId}, 'test-model'
      )
    `;
    const versionId = randomUUID();
    await sql`
      INSERT INTO agent_versions (
        id, agent_id, version, provider_credential_id, model, instructions
      ) VALUES (${versionId}, ${agentId}, 1, ${credentialId}, 'test-model', 'Use approved tools only.')
    `;
    const conversationId = randomUUID();
    await sql`INSERT INTO conversations (id, organization_id, agent_id, title, created_by_user_id) VALUES (${conversationId}, ${organizationId}, ${agentId}, 'Approval', ${userId})`;
    const runId = randomUUID();
    await sql`
      INSERT INTO runs (
        id, organization_id, agent_id, agent_version_id, conversation_id,
        status, request_id, input, provider, model
      ) VALUES (
        ${runId}, ${organizationId}, ${agentId}, ${versionId}, ${conversationId},
        'running', ${`approval-run-${runId}`}, 'Perform a sensitive action', 'openai', 'test-model'
      )
    `;
    const serverId = randomUUID();
    await sql`
      INSERT INTO mcp_servers (
        id, organization_id, name, endpoint, auth_mode, enabled, status
      ) VALUES (
        ${serverId}, ${organizationId}, 'Payments MCP', 'https://mcp.example.test/mcp',
        'bearer', true, 'connected'
      )
    `;
    const toolId = randomUUID();
    await sql`
      INSERT INTO mcp_tools (
        id, organization_id, server_id, name, title, input_schema,
        annotations, schema_hash, capability, enabled, risk
      ) VALUES (
        ${toolId}, ${organizationId}, ${serverId}, 'send_payment', 'إرسال دفعة',
        ${sql.json({ type: "object" })}, ${sql.json({ destructiveHint: true })},
        'approval-schema', 'payment', true, 'high'
      )
    `;
    return { organizationId, userId, credentialId, agentId, conversationId, runId, serverId, toolId };
  }

  async function requestApproval(fixture: Awaited<ReturnType<typeof seedApprovalRuntime>>, suffix: string) {
    const { requestToolApproval } = await import("@/lib/ai-sdk/approvals");
    const approvalId = `approval-${suffix}-${randomUUID()}`;
    const toolCallId = `tool-call-${suffix}-${randomUUID()}`;
    const argumentsValue = { accountId: "acct-123", apiKey: "secret-in-arguments" };
    const approval = await requestToolApproval({
      organizationId: fixture.organizationId,
      userId: fixture.userId,
      runId: fixture.runId,
      agentId: fixture.agentId,
      serverId: fixture.serverId,
      toolId: fixture.toolId,
      toolCallId,
      approvalId,
      arguments: argumentsValue,
      reason: "عملية دفع ذات أثر مالي.",
      risk: "high",
      capability: "payment",
      stepNumber: 1,
      checkpoint: {
        messages: [{ role: "user", content: "private approval prompt" }],
        pendingApproval: {
          approvalId,
          toolCallId,
          toolName: `mcp_${fixture.toolId.replaceAll("-", "")}`,
          toolId: fixture.toolId,
          arguments: argumentsValue,
        },
        agentId: fixture.agentId,
        conversationId: fixture.conversationId,
        requestId: `approval-run-${fixture.runId}`,
        providerCredentialId: fixture.credentialId,
        model: "test-model",
        candidateIndex: 0,
        emittedText: false,
        toolExecuted: false,
        sideEffectOccurred: false,
        toolResultSaved: false,
      },
    });
    return { approval, approvalId, toolCallId };
  }

  test("request stores an encrypted checkpoint and exposes only redacted arguments", async () => {
    const fixture = await seedApprovalRuntime();
    const requested = await requestApproval(fixture, "encrypted");
    const [run] = await sql<{ status: string }[]>`
      SELECT status FROM runs WHERE id = ${fixture.runId} AND organization_id = ${fixture.organizationId}
    `;
    const [checkpoint] = await sql<{ encrypted_state: string }[]>`
      SELECT encrypted_state FROM agent_run_checkpoints
      WHERE run_id = ${fixture.runId} AND organization_id = ${fixture.organizationId}
    `;
    expect(run?.status).toBe("waiting_approval");
    expect(checkpoint?.encrypted_state).toBeTruthy();
    expect(checkpoint?.encrypted_state).not.toContain("private approval prompt");
    expect(checkpoint?.encrypted_state).not.toContain("secret-in-arguments");

    const { listPendingToolApprovals } = await import("@/lib/ai-sdk/approvals");
    const rows = await listPendingToolApprovals(fixture.organizationId);
    const listed = rows.find((row) => row.approvalId === requested.approvalId);
    expect(listed).toMatchObject({
      toolName: "إرسال دفعة",
      serverName: "Payments MCP",
      agentName: "Approval Agent",
      risk: "high",
    });
    expect(listed?.argumentsSummary).toMatchObject({ apiKey: "[redacted]", accountId: "acct-123" });
  });

  test("approval is tenant isolated, decided once, consumed, and checkpoint can be removed", async () => {
    const fixture = await seedApprovalRuntime();
    const requested = await requestApproval(fixture, "decision");
    const otherOrganizationId = await createOrganization("Other Organization");
    const { decideToolApproval, getToolApproval, consumeToolApproval } = await import("@/lib/ai-sdk/approvals");

    await expect(getToolApproval(otherOrganizationId, requested.approvalId)).rejects.toMatchObject({ code: "TOOL_APPROVAL_NOT_FOUND" });
    await expect(decideToolApproval({
      organizationId: otherOrganizationId,
      approvalId: requested.approvalId,
      userId: fixture.userId,
      approved: true,
    })).rejects.toMatchObject({ code: "TOOL_APPROVAL_NOT_FOUND" });

    const approved = await decideToolApproval({
      organizationId: fixture.organizationId,
      approvalId: requested.approvalId,
      userId: fixture.userId,
      approved: true,
    });
    expect(approved.status).toBe("approved");
    await expect(decideToolApproval({
      organizationId: fixture.organizationId,
      approvalId: requested.approvalId,
      userId: fixture.userId,
      approved: false,
    })).rejects.toMatchObject({ code: "TOOL_APPROVAL_ALREADY_DECIDED" });

    const consumed = await consumeToolApproval({
      organizationId: fixture.organizationId,
      approvalId: requested.approvalId,
    });
    expect(consumed.status).toBe("consumed");
    const { deleteRunCheckpoints } = await import("@/lib/ai-sdk/checkpoints");
    await deleteRunCheckpoints(fixture.organizationId, fixture.runId);
    const [countRow] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM agent_run_checkpoints
      WHERE run_id = ${fixture.runId} AND organization_id = ${fixture.organizationId}
    `;
    expect(countRow?.count).toBe("0");
  });

  test("rejected approvals are consumable without executing the tool", async () => {
    const fixture = await seedApprovalRuntime();
    const requested = await requestApproval(fixture, "reject");
    const { decideToolApproval, consumeToolApproval } = await import("@/lib/ai-sdk/approvals");
    const rejected = await decideToolApproval({
      organizationId: fixture.organizationId,
      approvalId: requested.approvalId,
      userId: fixture.userId,
      approved: false,
      reason: "Rejected in integration test",
    });
    expect(rejected.status).toBe("rejected");
    const consumed = await consumeToolApproval({
      organizationId: fixture.organizationId,
      approvalId: requested.approvalId,
    });
    expect(consumed.status).toBe("consumed");
  });

  test("expired approval persists expired status and audit before returning conflict", async () => {
    const fixture = await seedApprovalRuntime();
    const requested = await requestApproval(fixture, "expired");
    await sql`UPDATE tool_approvals SET expires_at = now() - interval '1 minute' WHERE approval_id = ${requested.approvalId}`;
    const { decideToolApproval } = await import("@/lib/ai-sdk/approvals");
    await expect(decideToolApproval({
      organizationId: fixture.organizationId,
      approvalId: requested.approvalId,
      userId: fixture.userId,
      approved: true,
    })).rejects.toMatchObject({ code: "TOOL_APPROVAL_EXPIRED" });

    const [approval] = await sql<{ status: string }[]>`
      SELECT status FROM tool_approvals
      WHERE organization_id = ${fixture.organizationId} AND approval_id = ${requested.approvalId}
    `;
    const [audit] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM audit_logs
      WHERE organization_id = ${fixture.organizationId}
        AND action = 'tool_approval.expired'
        AND resource_id = ${requested.approval.id}
    `;
    expect(approval?.status).toBe("expired");
    expect(Number(audit?.count ?? 0)).toBeGreaterThan(0);
  });
});
