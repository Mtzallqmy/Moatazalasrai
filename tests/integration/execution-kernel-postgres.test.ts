import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createTestSqlClient, type Sql } from "../helpers/pg-sql";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeDatabase = databaseUrl ? describe : describe.skip;
const storageRoot = join(process.cwd(), ".data", `execution-tests-${process.pid}`);

describeDatabase("Execution Kernel PostgreSQL lifecycle", () => {
  let sql: Sql;

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl!;
    process.env.CREDENTIAL_ENCRYPTION_KEY ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    process.env.CREDENTIAL_ENCRYPTION_KEY_ID = "integration";
    process.env.EXECUTION_KERNEL_ENABLED = "true";
    process.env.EXECUTION_RUNNER = "existing";
    process.env.EXECUTION_TEST_RUNNER = "mock";
    process.env.SANDBOX_RUNNER_URL = "http://127.0.0.1:65535";
    process.env.SANDBOX_RUNNER_SHARED_SECRET = "integration-sandbox-runner-secret-000000000000";
    process.env.EXECUTION_CREDENTIAL_BROKER_ENABLED = "true";
    process.env.EXECUTION_CREDENTIAL_GRANT_TTL_SECONDS = "300";
    process.env.EXECUTION_PROXY_SHARED_SECRET = "integration-execution-proxy-secret-000000000000000";
    process.env.OBJECT_STORAGE_DRIVER = "local";
    process.env.ATTACHMENT_LOCAL_DIRECTORY = storageRoot;
    sql = createTestSqlClient(databaseUrl!, 5);
  });

  beforeEach(async () => {
    const { resetMockExecutionRunner } = await import("@/lib/execution/runners/mock-runner");
    const { resetObjectStorageForTests } = await import("@/lib/storage/object-storage");
    resetMockExecutionRunner();
    resetObjectStorageForTests();
  });

  afterAll(async () => {
    // execution_events are intentionally append-only, including against FK cascades.
    // Integration databases are isolated/ephemeral, so do not delete tenant rows here.
    const { releaseWorkerUtils } = await import("@/worker/queue");
    await releaseWorkerUtils();
    await sql.end({ timeout: 5 });
    await rm(storageRoot, { recursive: true, force: true });
  });

  async function fixture(role: "owner" | "admin" | "developer" | "operator" | "viewer" | "member" = "owner") {
    const organizationId = randomUUID();
    const userId = randomUUID();
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, ${`Execution ${organizationId}`}, ${`exec-${organizationId}`})`;
    await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`execution-${userId}@example.test`}, 'Execution User')`;
    await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${organizationId}, ${userId}, ${role})`;
    return { organizationId, userId, role };
  }

  async function createExecution(actor: Awaited<ReturnType<typeof fixture>>, scenario: "success" | "failure" | "timeout" | "secrets", key = `execution:${randomUUID()}`) {
    const { createDiagnosticExecution } = await import("@/lib/execution/service");
    return createDiagnosticExecution({
      actor,
      requestId: randomUUID(),
      body: {
        kind: "diagnostic.command",
        idempotencyKey: key,
        input: { scenario },
      },
    });
  }

  async function runSuccessLifecycle(actor: Awaited<ReturnType<typeof fixture>>) {
    const created = await createExecution(actor, "success");
    const { provisionExecution, runExecutionStep, collectExecutionArtifacts, cleanupExecution } = await import("@/lib/execution/worker-runtime");
    await provisionExecution({ organizationId: actor.organizationId, jobId: created.job.id, workerId: "integration-provision" });
    await runExecutionStep({ organizationId: actor.organizationId, jobId: created.job.id, workerId: "integration-run" });
    await collectExecutionArtifacts({ organizationId: actor.organizationId, jobId: created.job.id, workerId: "integration-artifact" });
    await cleanupExecution({ organizationId: actor.organizationId, jobId: created.job.id, workerId: "integration-cleanup" });
    return created.job.id;
  }

  test("creates the execution and Graphile work atomically with idempotency", async () => {
    const actor = await fixture();
    const key = `atomic:${randomUUID()}`;
    const first = await createExecution(actor, "success", key);
    const second = await createExecution(actor, "success", key);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.job.id).toBe(first.job.id);

    const [job] = await sql<{ status: string }[]>`
      SELECT status FROM execution_jobs WHERE id = ${first.job.id} AND organization_id = ${actor.organizationId}
    `;
    const [queued] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM graphile_worker.jobs
      WHERE key = ${`execution:provision:${first.job.id}`}
    `;
    expect(job?.status).toBe("queued");
    expect(Number(queued?.count ?? 0)).toBe(1);
  });

  test("completes only after stdout verification artifact storage and workspace cleanup", async () => {
    const actor = await fixture();
    const jobId = await runSuccessLifecycle(actor);
    const [job] = await sql<{ status: string; result_summary: Record<string, unknown> }[]>`
      SELECT status, result_summary FROM execution_jobs WHERE id = ${jobId} AND organization_id = ${actor.organizationId}
    `;
    const [workspace] = await sql<{ state: string; destroyed_at: Date | null }[]>`
      SELECT state, destroyed_at FROM execution_workspaces
      WHERE id = (SELECT workspace_id FROM execution_jobs WHERE id = ${jobId}) AND organization_id = ${actor.organizationId}
    `;
    const [artifact] = await sql<{ filename: string; sha256: string; size_bytes: string }[]>`
      SELECT filename, sha256, size_bytes::text FROM execution_artifacts
      WHERE job_id = ${jobId} AND organization_id = ${actor.organizationId}
    `;
    expect(job?.status).toBe("completed");
    expect(job?.result_summary.executionVerified).toBe(true);
    expect(workspace?.state).toBe("stopped");
    expect(workspace?.destroyed_at).not.toBeNull();
    expect(artifact?.filename).toBe("result.txt");
    expect(artifact?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(artifact?.size_bytes ?? 0)).toBe(2);

    const { executionArtifactDownload } = await import("@/lib/execution/artifact-service");
    const [artifactId] = await sql<{ id: string }[]>`
      SELECT id FROM execution_artifacts WHERE job_id = ${jobId} AND organization_id = ${actor.organizationId}
    `;
    const download = await executionArtifactDownload({ organizationId: actor.organizationId, jobId, artifactId: artifactId!.id });
    expect(download.body && Buffer.from(download.body.body).toString("utf8")).toBe("4\n");
  });

  test("records non-zero exit as failed and never completed", async () => {
    const actor = await fixture();
    const created = await createExecution(actor, "failure");
    const { provisionExecution, runExecutionStep, cleanupExecution } = await import("@/lib/execution/worker-runtime");
    await provisionExecution({ organizationId: actor.organizationId, jobId: created.job.id, workerId: "failure-provision" });
    await runExecutionStep({ organizationId: actor.organizationId, jobId: created.job.id, workerId: "failure-run" });
    await cleanupExecution({ organizationId: actor.organizationId, jobId: created.job.id, workerId: "failure-cleanup" });
    const [job] = await sql<{ status: string; error_code: string | null }[]>`
      SELECT status, error_code FROM execution_jobs WHERE id = ${created.job.id} AND organization_id = ${actor.organizationId}
    `;
    const [step] = await sql<{ status: string; exit_code: number | null }[]>`
      SELECT status, exit_code FROM execution_steps WHERE job_id = ${created.job.id} AND sequence = 1
    `;
    expect(job?.status).toBe("failed");
    expect(job?.error_code).toBeTruthy();
    expect(step?.status).toBe("failed");
    expect(step?.exit_code).not.toBe(0);
  });

  test("times out and cleans the workspace", async () => {
    const actor = await fixture();
    const created = await createExecution(actor, "timeout");
    const { provisionExecution, runExecutionStep, cleanupExecution } = await import("@/lib/execution/worker-runtime");
    await provisionExecution({ organizationId: actor.organizationId, jobId: created.job.id, workerId: "timeout-provision" });
    await runExecutionStep({ organizationId: actor.organizationId, jobId: created.job.id, workerId: "timeout-run" });
    await cleanupExecution({ organizationId: actor.organizationId, jobId: created.job.id, workerId: "timeout-cleanup" });
    const [row] = await sql<{ status: string; state: string }[]>`
      SELECT j.status, w.state
      FROM execution_jobs j JOIN execution_workspaces w ON w.id = j.workspace_id
      WHERE j.id = ${created.job.id} AND j.organization_id = ${actor.organizationId}
    `;
    expect(row?.status).toBe("timed_out");
    expect(row?.state).toBe("stopped");
  });

  test("cancellation is idempotent and only becomes cancelled after worker confirmation", async () => {
    const actor = await fixture();
    const created = await createExecution(actor, "success");
    const { requestExecutionCancellation } = await import("@/lib/execution/cancellation-service");
    const first = await requestExecutionCancellation({ actor, jobId: created.job.id, requestId: randomUUID() });
    const second = await requestExecutionCancellation({ actor, jobId: created.job.id, requestId: randomUUID() });
    expect(first.job.status).toBe("cancel_requested");
    expect(second.accepted).toBe(true);
    const { cancelExecution, cleanupExecution } = await import("@/lib/execution/worker-runtime");
    await cancelExecution({ organizationId: actor.organizationId, jobId: created.job.id, workerId: "cancel-worker" });
    await cleanupExecution({ organizationId: actor.organizationId, jobId: created.job.id, workerId: "cancel-cleanup" });
    const [job] = await sql<{ status: string }[]>`
      SELECT status FROM execution_jobs WHERE id = ${created.job.id} AND organization_id = ${actor.organizationId}
    `;
    expect(job?.status).toBe("cancelled");
  });

  test("enforces tenant isolation for reads artifacts and cancellation", async () => {
    const owner = await fixture();
    const other = await fixture();
    const jobId = await runSuccessLifecycle(owner);
    const { getExecutionJob } = await import("@/lib/execution/repository");
    await expect(getExecutionJob({ organizationId: other.organizationId, jobId })).rejects.toMatchObject({ code: "EXECUTION_NOT_FOUND" });
    const { listExecutionArtifacts } = await import("@/lib/execution/artifact-service");
    expect(await listExecutionArtifacts({ organizationId: other.organizationId, jobId, page: 1, limit: 10 })).toEqual([]);
    const { requestExecutionCancellation } = await import("@/lib/execution/cancellation-service");
    await expect(requestExecutionCancellation({ actor: other, jobId, requestId: randomUUID() })).rejects.toMatchObject({ code: "EXECUTION_NOT_FOUND" });
  });

  test("leases reject concurrent acquisition until expiry", async () => {
    const actor = await fixture();
    const created = await createExecution(actor, "success");
    const { acquireExecutionLease, releaseExecutionLease } = await import("@/lib/execution/repository");
    const first = await acquireExecutionLease({ organizationId: actor.organizationId, jobId: created.job.id, workerId: "one", ttlSeconds: 60 });
    await expect(acquireExecutionLease({ organizationId: actor.organizationId, jobId: created.job.id, workerId: "two", ttlSeconds: 60 }))
      .rejects.toMatchObject({ code: "EXECUTION_LEASE_UNAVAILABLE" });
    await releaseExecutionLease({ jobId: created.job.id, token: first.token });
    const second = await acquireExecutionLease({ organizationId: actor.organizationId, jobId: created.job.id, workerId: "two", ttlSeconds: 60 });
    expect(second.token).not.toBe(first.token);
    await releaseExecutionLease({ jobId: created.job.id, token: second.token });
  });

  test("events are append-only at the PostgreSQL layer", async () => {
    const actor = await fixture();
    const created = await createExecution(actor, "success");
    await expect(sql`
      UPDATE execution_events SET level = 'warn' WHERE job_id = ${created.job.id} AND sequence = 1
    `).rejects.toThrow(/append-only/);
    await expect(sql`
      DELETE FROM execution_events WHERE job_id = ${created.job.id} AND sequence = 1
    `).rejects.toThrow(/append-only/);
  });

  test("credential grants store hashes expire and reject replay", async () => {
    const actor = await fixture();
    const created = await createExecution(actor, "success");
    const credentialId = randomUUID();
    await sql`
      INSERT INTO provider_credentials (
        id, organization_id, provider, provider_type_id, transport_mode, credential_mode,
        name, base_url, encrypted_secret, secret_hint, discovered_models, validation_status, enabled
      ) VALUES (
        ${credentialId}, ${actor.organizationId}, 'openai', 'openai', 'direct', 'encrypted_byok',
        'Execution Provider', 'https://api.openai.com/v1', 'encrypted-placeholder', 'test',
        ${sql.json(["test-model"])}, 'verified', true
      )
    `;
    const { issueExecutionCredentialGrant, consumeExecutionCredentialGrant } = await import("@/lib/execution/credential-grant-service");
    const issued = await issueExecutionCredentialGrant({
      organizationId: actor.organizationId,
      userId: actor.userId,
      jobId: created.job.id,
      credentialId,
      allowedHosts: ["api.openai.com"],
      allowedOperations: ["responses.create"],
      budget: { maxRequests: 1, maxTokens: 100 },
    });
    const [stored] = await sql<{ token_hash: string }[]>`
      SELECT token_hash FROM execution_credential_grants WHERE id = ${issued.grantId}
    `;
    expect(stored?.token_hash).not.toBe(issued.token);
    expect(stored?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    const consumed = await consumeExecutionCredentialGrant({
      token: issued.token,
      jobId: created.job.id,
      host: "api.openai.com",
      operation: "responses.create",
    });
    expect(consumed.credentialId).toBe(credentialId);
    await expect(consumeExecutionCredentialGrant({
      token: issued.token,
      jobId: created.job.id,
      host: "api.openai.com",
      operation: "responses.create",
    })).rejects.toMatchObject({ code: "EXECUTION_GRANT_INVALID" });
  });
});
