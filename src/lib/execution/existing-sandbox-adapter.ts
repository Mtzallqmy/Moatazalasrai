import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { executionJobs, executionWorkspaces } from "@/db/execution-schema";
import { env } from "@/lib/config/env";
import type { ExecutionRunner } from "@/lib/execution/contracts";
import { ApiError } from "@/lib/http/api";
import {
  createRunnerWorkspace,
  deleteRunnerWorkspace,
  getRunnerExecution,
  listRunnerFiles,
  readRunnerFile,
  startRunnerExecution,
  stopRunnerExecution,
  writeRunnerFile,
} from "@/lib/sandbox/runner-client";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function assertNetworkPolicy(mode: "deny_all" | "allowlist", hosts: string[]) {
  if (mode !== "deny_all" || hosts.length > 0) {
    throw new ApiError(422, "EXECUTION_NETWORK_UNSUPPORTED", "مشغل Sandbox الحالي يدعم شبكة مغلقة فقط.");
  }
}

function runnerExecutionId(jobId: string, key: string) {
  const digest = createHash("sha256").update(key, "utf8").digest("hex").slice(0, 20);
  return `${jobId}-${digest}`;
}

export class ExistingSandboxAdapter implements ExecutionRunner {
  readonly kind = "existing_sandbox";

  async health() {
    const config = env();
    if (!config.sandboxEnabled || !config.sandboxRunnerUrl || !config.sandboxRunnerSharedSecret) {
      return { ok: false, detail: "sandbox runtime is not configured" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(new URL("/health", `${config.sandboxRunnerUrl}/`), {
        cache: "no-store",
        signal: controller.signal,
      });
      return { ok: response.ok, detail: response.ok ? undefined : `health status ${response.status}` };
    } catch {
      return { ok: false, detail: "sandbox runner is unavailable" };
    } finally {
      clearTimeout(timer);
    }
  }

  async provision(context: Parameters<ExecutionRunner["provision"]>[0]) {
    assertNetworkPolicy(context.networkPolicy.mode, context.networkPolicy.hosts);
    const result = await createRunnerWorkspace({
      tenantId: context.organizationId,
      workspaceId: context.workspaceId,
      template: context.template,
      diskLimitBytes: context.limits.diskBytes,
      networkMode: "disabled",
    });
    return { id: context.workspaceId, externalRef: result.workspaceId, status: result.status } as const;
  }

  async execute(context: Parameters<ExecutionRunner["execute"]>[0]) {
    assertNetworkPolicy(context.networkPolicy.mode, context.networkPolicy.hosts);
    const timeoutMs = Math.min(context.command.timeoutMs ?? context.limits.timeoutMs, context.limits.timeoutMs);
    const maxOutputBytes = Math.min(context.command.maxOutputBytes ?? context.limits.maxOutputBytes, context.limits.maxOutputBytes);
    const externalExecutionId = runnerExecutionId(context.executionJobId, context.command.idempotencyKey);
    const [workspaceRow] = await db().select({ metadata: executionWorkspaces.metadata }).from(executionWorkspaces).where(and(
      eq(executionWorkspaces.id, context.workspaceId),
      eq(executionWorkspaces.organizationId, context.organizationId),
    )).limit(1);
    await db().update(executionWorkspaces).set({
      metadata: { ...(workspaceRow?.metadata ?? {}), currentExternalExecutionId: externalExecutionId },
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(executionWorkspaces.id, context.workspaceId), eq(executionWorkspaces.organizationId, context.organizationId)));

    const started = await startRunnerExecution({
      tenantId: context.organizationId,
      workspaceId: context.externalWorkspaceRef,
      executionId: externalExecutionId,
      command: context.command.command,
      workingDirectory: context.command.workingDirectory ?? ".",
      timeoutMs,
      maxOutputBytes,
    });

    let sequence = 0;
    let stdout = "";
    let stderr = "";
    const deadline = Date.now() + timeoutMs + 20_000;
    try {
      while (Date.now() < deadline) {
        const snapshot = await getRunnerExecution({
          tenantId: context.organizationId,
          externalWorkspaceId: context.externalWorkspaceRef,
          externalExecutionId: started.executionId,
          after: sequence,
        });
        for (const event of snapshot.events) {
          sequence = Math.max(sequence, event.sequence);
          if (event.type !== "output" || typeof event.payload.text !== "string") continue;
          if (event.stream === "stderr") stderr += event.payload.text;
          else stdout += event.payload.text;
        }
        const [job] = await db().select({ cancelRequestedAt: executionJobs.cancelRequestedAt }).from(executionJobs).where(and(
          eq(executionJobs.id, context.executionJobId),
          eq(executionJobs.organizationId, context.organizationId),
        )).limit(1);
        if (job?.cancelRequestedAt && snapshot.status === "running") {
          await stopRunnerExecution({
            tenantId: context.organizationId,
            externalWorkspaceId: context.externalWorkspaceRef,
            externalExecutionId: started.executionId,
          }).catch(() => undefined);
        }
        if (snapshot.status !== "running") {
          return {
            status: snapshot.status,
            exitCode: snapshot.exitCode,
            stdout,
            stderr,
            outputTruncated: snapshot.outputTruncated,
            stdoutBytes: snapshot.stdoutBytes,
            stderrBytes: snapshot.stderrBytes,
          };
        }
        await sleep(300);
      }
      await stopRunnerExecution({
        tenantId: context.organizationId,
        externalWorkspaceId: context.externalWorkspaceRef,
        externalExecutionId: started.executionId,
      }).catch(() => undefined);
      return {
        status: "timed_out",
        exitCode: null,
        stdout,
        stderr,
        outputTruncated: false,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
      };
    } finally {
      const [fresh] = await db().select({ metadata: executionWorkspaces.metadata }).from(executionWorkspaces).where(and(
        eq(executionWorkspaces.id, context.workspaceId), eq(executionWorkspaces.organizationId, context.organizationId),
      )).limit(1);
      if (fresh?.metadata?.currentExternalExecutionId === externalExecutionId) {
        const { currentExternalExecutionId: _ignored, ...rest } = fresh.metadata;
        await db().update(executionWorkspaces).set({ metadata: rest, updatedAt: new Date() }).where(and(
          eq(executionWorkspaces.id, context.workspaceId), eq(executionWorkspaces.organizationId, context.organizationId),
        ));
      }
    }
  }

  async writeFile(context: Parameters<ExecutionRunner["writeFile"]>[0]) {
    const result = await writeRunnerFile({
      tenantId: context.organizationId,
      externalWorkspaceId: context.externalWorkspaceRef,
      path: context.path,
      content: Buffer.from(context.content).toString("base64"),
      encoding: "base64",
      overwrite: true,
    });
    return { path: result.path, sizeBytes: result.sizeBytes, sha256: result.sha256 };
  }

  async readFile(context: Parameters<ExecutionRunner["readFile"]>[0]) {
    const result = await readRunnerFile({
      tenantId: context.organizationId,
      externalWorkspaceId: context.externalWorkspaceRef,
      path: context.path,
      maxBytes: context.maxBytes,
    });
    const content = result.encoding === "base64"
      ? Buffer.from(result.content, "base64")
      : Buffer.from(result.content, "utf8");
    return { path: context.path, content, sizeBytes: result.sizeBytes, sha256: result.sha256 };
  }

  async listFiles(context: Parameters<ExecutionRunner["listFiles"]>[0]) {
    const result = await listRunnerFiles({
      tenantId: context.organizationId,
      externalWorkspaceId: context.externalWorkspaceRef,
      path: context.path ?? ".",
      depth: Math.min(Math.max(context.depth ?? 2, 0), 8),
    });
    return result.files;
  }

  async cancel(context: Parameters<ExecutionRunner["cancel"]>[0]) {
    const [workspace] = await db().select({ metadata: executionWorkspaces.metadata }).from(executionWorkspaces).where(and(
      eq(executionWorkspaces.id, context.workspaceId), eq(executionWorkspaces.organizationId, context.organizationId),
    )).limit(1);
    const externalExecutionId = typeof workspace?.metadata?.currentExternalExecutionId === "string"
      ? workspace.metadata.currentExternalExecutionId
      : null;
    if (!externalExecutionId) return;
    await stopRunnerExecution({
      tenantId: context.organizationId,
      externalWorkspaceId: context.externalWorkspaceRef,
      externalExecutionId,
    }).catch(() => undefined);
  }

  async cleanup(context: Parameters<ExecutionRunner["cleanup"]>[0]) {
    await deleteRunnerWorkspace({ tenantId: context.organizationId, externalWorkspaceId: context.externalWorkspaceRef });
  }
}
