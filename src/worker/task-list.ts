import type { TaskList } from "graphile-worker";
import { agentRunResumeTask } from "@/worker/tasks/agent-run-resume";
import { agentTeamRunTask } from "@/worker/tasks/agent-team-run";
import { attachmentScanTask } from "@/worker/tasks/attachment-scan";
import { browserTaskExecuteTask } from "@/worker/tasks/browser-task-execute";
import { browserTaskResumeTask } from "@/worker/tasks/browser-task-resume";
import { documentParseTask } from "@/worker/tasks/document-parse";
import { sandboxCleanupTask } from "@/worker/tasks/sandbox-cleanup";
import { sandboxCreateTask } from "@/worker/tasks/sandbox-create";
import { sandboxExecuteTask } from "@/worker/tasks/sandbox-execute";
import { sandboxResetTask } from "@/worker/tasks/sandbox-reset";
import { sandboxResumeTask } from "@/worker/tasks/sandbox-resume";

export const taskList = {
  "agent-run-resume": agentRunResumeTask,
  "agent-team-run": agentTeamRunTask,
  "attachment-scan": attachmentScanTask,
  "browser-task-execute": browserTaskExecuteTask,
  "browser-task-resume": browserTaskResumeTask,
  "document-parse": documentParseTask,
  "sandbox-create": sandboxCreateTask,
  "sandbox-execute": sandboxExecuteTask,
  "sandbox-resume": sandboxResumeTask,
  "sandbox-reset": sandboxResetTask,
  "sandbox-cleanup": sandboxCleanupTask,
  "sandbox-artifact-cleanup": sandboxCleanupTask,
  "sandbox-health-check": sandboxCleanupTask,
} satisfies TaskList;

export const supportedWorkerTaskNames = Object.freeze(Object.keys(taskList));
