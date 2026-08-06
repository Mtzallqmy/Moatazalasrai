import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestSqlClient, type Sql } from "../helpers/pg-sql";
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
});
