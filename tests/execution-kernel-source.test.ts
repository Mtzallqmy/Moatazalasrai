import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("execution kernel source contracts", () => {
  it("never executes the diagnostic inside Next.js or Graphile Worker", async () => {
    const service = await readFile("src/lib/execution/service.ts", "utf8");
    const runtime = await readFile("src/lib/execution/worker-runtime.ts", "utf8");
    const adapter = await readFile("src/lib/execution/runners/existing-sandbox-adapter.ts", "utf8");
    expect(service).not.toContain("child_process");
    expect(service).not.toContain("spawn(");
    expect(runtime).not.toContain("child_process");
    expect(runtime).not.toContain("spawn(");
    expect(adapter).toContain("startRunnerExecution");
    expect(adapter).toContain("argv: input.argv");
    expect(adapter).not.toContain("command: input");
  });

  it("uses a PostgreSQL transaction to create the execution and Graphile job", async () => {
    const service = await readFile("src/lib/execution/service.ts", "utf8");
    const repository = await readFile("src/lib/execution/repository.ts", "utf8");
    expect(service).toContain("db().transaction");
    expect(service).toContain("enqueueExecutionTaskTx(tx");
    expect(repository).toContain("graphile_worker.add_job");
    expect(repository).toContain('queueName: "execution-provision"');
    expect(repository).not.toContain("graphile_worker.jobs");
  });

  it("keeps Graphile payloads ID-only and queue names low-cardinality", async () => {
    const schemas = await readFile("src/worker/schemas.ts", "utf8");
    const queue = await readFile("src/worker/queue.ts", "utf8");
    expect(schemas).toContain("executionTaskPayloadSchema");
    expect(schemas).toContain("organizationId: uuid");
    expect(schemas).toContain("jobId: uuid");
    expect(queue).toContain('queueName: "execution-provision"');
    expect(queue).toContain('queueName: "execution-run"');
    expect(queue).toContain('queueName: "execution-cleanup"');
    expect(queue).not.toContain("queueName: `execution:${payload.jobId}`");
  });

  it("binds runner requests to timestamp nonce service identity and body hash", async () => {
    const client = await readFile("src/lib/sandbox/runner-client.ts", "utf8");
    const runner = await readFile("services/sandbox-runner/server.mjs", "utf8");
    for (const header of ["x-moataz-timestamp", "x-moataz-nonce", "x-moataz-service", "x-moataz-body-sha256", "x-moataz-signature"]) {
      expect(client).toContain(header);
      expect(runner).toContain(header);
    }
    expect(client).toContain('service: "platform-execution-kernel"');
    expect(runner).toContain("usedNonces.has(nonce)");
    expect(runner).toContain("timingSafeEqual");
  });

  it("runs argv directly with a minimal environment and no network", async () => {
    const runner = await readFile("services/sandbox-runner/server.mjs", "utf8");
    expect(runner).toContain('if (command.mode === "argv") return [...args, "--", ...command.argv]');
    expect(runner).toContain('"--unshare-net"');
    expect(runner).toContain("SAFE_ENVIRONMENT_KEYS");
    expect(runner).toContain("FORBIDDEN_ENVIRONMENT");
    expect(runner).toContain("ALLOWED_EXECUTABLES");
    expect(runner).toContain("prlimit");
    expect(runner).toContain("bubblewrap");
  });

  it("rejects symlink escape path traversal and unsupported file types", async () => {
    const runner = await readFile("services/sandbox-runner/server.mjs", "utf8");
    expect(runner).toContain("assertNoSymlinkSegments");
    expect(runner).toContain("SYMLINK_FORBIDDEN");
    expect(runner).toContain("PATH_TRAVERSAL");
    expect(runner).toContain("FILE_TYPE_FORBIDDEN");
    expect(runner).toContain("entry.isSymbolicLink()");
  });

  it("requires verified execution evidence and artifacts before completed", async () => {
    const states = await readFile("src/lib/execution/states.ts", "utf8");
    const runtime = await readFile("src/lib/execution/worker-runtime.ts", "utf8");
    expect(states).toContain("assertCompletionEvidence");
    expect(states).toContain("summary.executionVerified !== true");
    expect(states).toContain("requiredArtifactCount");
    expect(runtime).toContain("executionVerified: true");
    expect(runtime).toContain("workspace.destroyed");
  });

  it("stores append-only events and exposes resumable SSE", async () => {
    const migration = await readFile("drizzle/0043_execution_kernel_foundation.sql", "utf8");
    const route = await readFile("src/app/api/executions/[executionId]/events/route.ts", "utf8");
    expect(migration).toContain("prevent_execution_event_mutation");
    expect(migration).toContain("execution_events_append_only_update");
    expect(migration).toContain("execution_events_append_only_delete");
    expect(route).toContain('request.headers.get("last-event-id")');
    expect(route).toContain('"content-type": "text/event-stream; charset=utf-8"');
    expect(route).toContain("heartbeat");
  });

  it("keeps external adapters optional and gVisor off Railway", async () => {
    const environment = await readFile("src/lib/config/env.ts", "utf8");
    const e2b = await readFile("src/lib/execution/runners/e2b-adapter.ts", "utf8");
    const daytona = await readFile("src/lib/execution/runners/daytona-adapter.ts", "utf8");
    const gvisor = await readFile("src/lib/execution/runners/gvisor-adapter.ts", "utf8");
    expect(environment).toContain('EXECUTION_E2B_ENABLED');
    expect(environment).toContain('EXECUTION_DAYTONA_ENABLED');
    expect(environment).toContain('EXECUTION_GVISOR_ENABLED');
    expect(environment).toContain("gVisor/runsc requires a dedicated host and is not supported inside Railway");
    expect(e2b).toContain("E2B_ADAPTER_NOT_INSTALLED");
    expect(daytona).toContain("DAYTONA_ADAPTER_NOT_INSTALLED");
    expect(gvisor).toContain("GVISOR_UNSUPPORTED_ON_RAILWAY");
  });

  it("provides only one fixed diagnostic instead of free command execution", async () => {
    const contracts = await readFile("src/lib/execution/contracts.ts", "utf8");
    const validation = await readFile("src/lib/execution/validation.ts", "utf8");
    const consoleSource = await readFile("src/components/execution-kernel-console.tsx", "utf8");
    expect(contracts).toContain('kind: z.literal("diagnostic.command")');
    expect(validation).toContain("لا يسمح بأوامر حرة في المرحلة الأولى");
    expect(consoleSource).toContain('input: { scenario: "success" }');
    expect(consoleSource).not.toContain("<textarea");
    expect(consoleSource).not.toContain("commandInput");
  });
});
