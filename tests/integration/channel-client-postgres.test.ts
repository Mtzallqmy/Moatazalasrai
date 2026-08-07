import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestSqlClient, type Sql } from "../helpers/pg-sql";
import { createAgentApplication } from "@/lib/agents/application-service";
import {
  createChannelTeamRun,
  listChannelTeams,
} from "@/lib/channel-client/operations-service";
import {
  advanceChannelFlow,
  ensureChannelClientSession,
  finishChannelFlow,
  startChannelFlow,
  updateChannelClientSession,
} from "@/lib/channel-client/session-service";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("persistent channel client sessions", () => {
  let sql: Sql;
  const organizationId = randomUUID();
  const userId = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl!;
    sql = createTestSqlClient(databaseUrl!, 3);
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, 'Channel Session Test', ${`channel-${organizationId}`})`;
    await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`channel-${userId}@example.test`}, 'Channel Admin')`;
    await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${organizationId}, ${userId}, 'admin')`;
  });

  afterAll(async () => {
    await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
    await sql.end({ timeout: 5 });
  });

  test("persists an agent creation flow and treats a normal name as data", async () => {
    const initial = await ensureChannelClientSession({
      channel: "telegram",
      userId,
      organizationId,
      externalUserId: `tg-${userId}`,
      externalChatId: `chat-${userId}`,
    });
    const started = await startChannelFlow(initial, "agent.create", "name", {});
    const named = await advanceChannelFlow(started, "description", { name: "مساعد المحتوى" });

    expect(named.activeFlow).toBe("agent.create");
    expect(named.currentStep).toBe("description");
    expect(named.state).toEqual({ name: "مساعد المحتوى" });

    const [stored] = await sql<{ active_flow: string; current_step: string; state: Record<string, unknown> }[]>`
      SELECT active_flow, current_step, state
      FROM telegram_user_sessions
      WHERE telegram_user_id = ${`tg-${userId}`}
    `;
    expect(stored).toMatchObject({
      active_flow: "agent.create",
      current_step: "description",
      state: { name: "مساعد المحتوى" },
    });
  });

  test("uses optimistic locking so concurrent steps cannot overwrite each other", async () => {
    const session = await ensureChannelClientSession({
      channel: "telegram",
      userId,
      organizationId,
      externalUserId: `tg-${userId}`,
      externalChatId: `chat-${userId}`,
    });
    const results = await Promise.allSettled([
      updateChannelClientSession(session, { currentStep: "provider", state: { winner: 1 } }),
      updateChannelClientSession(session, { currentStep: "model", state: { winner: 2 } }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection).toBeDefined();
    if (rejection?.status === "rejected") {
      expect(rejection.reason).toMatchObject({ code: "CHANNEL_SESSION_CONFLICT" });
    }
  });

  test("persists an independent WhatsApp client session and clears only the active flow", async () => {
    const initial = await ensureChannelClientSession({
      channel: "whatsapp",
      userId,
      organizationId,
      externalUserId: `wa-${userId}`,
      externalChatId: `wa-${userId}`,
    });
    const started = await startChannelFlow(initial, "chat", "message", { source: "whatsapp" });
    const finished = await finishChannelFlow(started);
    expect(finished.channel).toBe("whatsapp");
    expect(finished.activeFlow).toBeNull();
    expect(finished.currentStep).toBeNull();
    expect(finished.state).toEqual({});
  });

  test("creates a real provider-backed agent through the shared application service", async () => {
    const providerId = randomUUID();
    const model = "channel-test-model";
    await sql`
      INSERT INTO provider_credentials (
        id, organization_id, provider, name, base_url, provider_type_id,
        default_model, allowed_models, discovered_models, validation_status,
        health_status, enabled, is_default
      ) VALUES (
        ${providerId}, ${organizationId}, 'openai_compatible', 'Channel Test Provider',
        'https://provider.example/v1', 'openai-compatible', ${model},
        ${sql.json([model])}, ${sql.json([model])}, 'verified', 'healthy', true, true
      )
    `;

    const result = await createAgentApplication({
      organizationId,
      userId,
      requestId: "channel-integration-test",
      source: "telegram",
      data: {
        name: "وكيل تيليجرام الحقيقي",
        description: "أُنشئ من خدمة التطبيق المشتركة.",
        instructions: "أجب بوضوح واستخدم بيانات المؤسسة المصرح بها فقط.",
        providerCredentialId: providerId,
        model,
        temperature: 0.2,
        maxOutputTokens: 1024,
        publish: true,
      },
    });

    expect(result.agent.status).toBe("published");
    expect(result.version.providerCredentialId).toBe(providerId);
    expect(result.version.model).toBe(model);

    const [stored] = await sql<{
      agent_name: string;
      agent_status: string;
      version_model: string;
      audit_source: string;
    }[]>`
      SELECT
        a.name AS agent_name,
        a.status AS agent_status,
        v.model AS version_model,
        l.metadata->>'source' AS audit_source
      FROM agents a
      JOIN agent_versions v ON v.agent_id = a.id AND v.version = a.current_version
      JOIN audit_logs l ON l.resource_type = 'agent' AND l.resource_id = a.id::text
      WHERE a.id = ${result.agent.id}
      LIMIT 1
    `;
    expect(stored).toEqual({
      agent_name: "وكيل تيليجرام الحقيقي",
      agent_status: "published",
      version_model: model,
      audit_source: "telegram",
    });
  });

  test("recognizes a published supervisor plus one published worker and queues a real team run", async () => {
    const providerId = randomUUID();
    const model = "channel-team-model";
    await sql`
      INSERT INTO provider_credentials (
        id, organization_id, provider, name, base_url, provider_type_id,
        default_model, allowed_models, discovered_models, validation_status,
        health_status, enabled, is_default
      ) VALUES (
        ${providerId}, ${organizationId}, 'openai_compatible', 'Channel Team Provider',
        'https://provider.example/v1', 'openai-compatible', ${model},
        ${sql.json([model])}, ${sql.json([model])}, 'verified', 'healthy', true, false
      )
    `;
    const supervisor = await createAgentApplication({
      organizationId,
      userId,
      requestId: "channel-team-supervisor",
      source: "whatsapp",
      data: {
        name: "مشرف الفريق",
        description: "مشرف اختبار",
        instructions: "ادمج النتائج.",
        providerCredentialId: providerId,
        model,
        temperature: 0.2,
        maxOutputTokens: 1024,
        publish: true,
      },
    });
    const worker = await createAgentApplication({
      organizationId,
      userId,
      requestId: "channel-team-worker",
      source: "whatsapp",
      data: {
        name: "عامل الفريق",
        description: "عامل اختبار",
        instructions: "حلل المهمة.",
        providerCredentialId: providerId,
        model,
        temperature: 0.2,
        maxOutputTokens: 1024,
        publish: true,
      },
    });
    const teamId = randomUUID();
    await sql`
      INSERT INTO agent_teams (id, organization_id, name, supervisor_agent_id, enabled, max_parallel_workers)
      VALUES (${teamId}, ${organizationId}, 'فريق قناة الاختبار', ${supervisor.agent.id}, true, 2)
    `;
    await sql`
      INSERT INTO agent_team_members (organization_id, team_id, agent_id, role, position)
      VALUES (${organizationId}, ${teamId}, ${worker.agent.id}, 'worker', 0)
    `;

    const teams = await listChannelTeams({ organizationId, userId, page: 1 });
    const team = teams.rows.find((row) => row.id === teamId);
    expect(team).toMatchObject({
      id: teamId,
      ready: true,
      supervisor: { id: supervisor.agent.id, status: "published" },
    });
    expect(team?.members).toHaveLength(1);
    expect(team?.members[0]).toMatchObject({ agentId: worker.agent.id, agentStatus: "published" });

    const run = await createChannelTeamRun({
      organizationId,
      userId,
      teamId,
      prompt: "حلل حالة الاختبار دون تنفيذ المزود داخل اختبار قاعدة البيانات.",
      requestId: `channel-team-run-${teamId}`,
    });
    expect(run.status).toBe("queued");
    expect(run.teamId).toBe(teamId);

    const [storedRun] = await sql<{ id: string; status: string; graphile_job_id: string | null }[]>`
      SELECT id, status, graphile_job_id
      FROM agent_team_runs
      WHERE id = ${run.id}
    `;
    expect(storedRun?.status).toBe("queued");
    expect(storedRun?.graphile_job_id).toBeTruthy();
  });
});
