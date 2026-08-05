import type { TaskList } from "graphile-worker";
import { runWithSystemDatabaseContext, runWithTenantDatabaseContext } from "@/lib/security/database-context";
import { agentRunResumeTask } from "@/worker/tasks/agent-run-resume";
import { agentTeamRunTask } from "@/worker/tasks/agent-team-run";
import { browserTaskExecuteTask } from "@/worker/tasks/browser-task-execute";
import { browserTaskResumeTask } from "@/worker/tasks/browser-task-resume";
import { documentParseTask } from "@/worker/tasks/document-parse";
import { sandboxCleanupTask } from "@/worker/tasks/sandbox-cleanup";
import { sandboxCreateTask } from "@/worker/tasks/sandbox-create";
import { sandboxExecuteTask } from "@/worker/tasks/sandbox-execute";
import { sandboxResetTask } from "@/worker/tasks/sandbox-reset";
import { sandboxResumeTask } from "@/worker/tasks/sandbox-resume";

type WorkerTask = TaskList[string];

function scopedTask(taskName: string, task: WorkerTask): WorkerTask {
  return async (payload, helpers) => {
    const organizationId = payload && typeof payload === "object" && "organizationId" in payload
      ? String((payload as { organizationId?: unknown }).organizationId ?? "")
      : "";
    if (organizationId) {
      return runWithTenantDatabaseContext(organizationId, null, () => task(payload, helpers));
    }
    return runWithSystemDatabaseContext(`worker:${taskName}`, () => task(payload, helpers));
  };
}

export const taskList = {
  "agent-run-resume": scopedTask("agent-run-resume", agentRunResumeTask),
  "agent-team-run": scopedTask("agent-team-run", agentTeamRunTask),
  "browser-task-execute": scopedTask("browser-task-execute", browserTaskExecuteTask),
  "browser-task-resume": scopedTask("browser-task-resume", browserTaskResumeTask),
  "document-parse": scopedTask("document-parse", documentParseTask),
  "sandbox-create": scopedTask("sandbox-create", sandboxCreateTask),
  "sandbox-execute": scopedTask("sandbox-execute", sandboxExecuteTask),
  "sandbox-resume": scopedTask("sandbox-resume", sandboxResumeTask),
  "sandbox-reset": scopedTask("sandbox-reset", sandboxResetTask),
  "sandbox-cleanup": scopedTask("sandbox-cleanup", sandboxCleanupTask),
  "sandbox-artifact-cleanup": scopedTask("sandbox-artifact-cleanup", sandboxCleanupTask),
  "sandbox-health-check": scopedTask("sandbox-health-check", sandboxCleanupTask),
} satisfies TaskList;

export const supportedWorkerTaskNames = Object.freeze(Object.keys(taskList));
