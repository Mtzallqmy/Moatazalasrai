import type { TaskList } from "graphile-worker";
import { agentRunResumeTask } from "@/worker/tasks/agent-run-resume";
import { agentTeamRunTask } from "@/worker/tasks/agent-team-run";
import { browserTaskExecuteTask } from "@/worker/tasks/browser-task-execute";
import { browserTaskResumeTask } from "@/worker/tasks/browser-task-resume";
import { documentParseTask } from "@/worker/tasks/document-parse";
import { executionCancelTask } from "@/worker/tasks/execution-cancel";
import { executionCleanupTask } from "@/worker/tasks/execution-cleanup";
import { executionCollectArtifactsTask } from "@/worker/tasks/execution-collect-artifacts";
import { executionExpireTask } from "@/worker/tasks/execution-expire";
import { executionProvisionTask } from "@/worker/tasks/execution-provision";
import { executionReconcileTask } from "@/worker/tasks/execution-reconcile";
import { executionRunStepTask } from "@/worker/tasks/execution-run-step";
import { notificationDispatchTask } from "@/worker/tasks/notification-dispatch";
import { operationalToolExecuteTask } from "@/worker/tasks/operational-tool-execute";
import { sandboxCleanupTask } from "@/worker/tasks/sandbox-cleanup";
import { sandboxCreateTask } from "@/worker/tasks/sandbox-create";
import { sandboxExecuteTask } from "@/worker/tasks/sandbox-execute";
import { sandboxResetTask } from "@/worker/tasks/sandbox-reset";
import { sandboxResumeTask } from "@/worker/tasks/sandbox-resume";
import { telegramUpdateProcessTask } from "@/worker/tasks/telegram-update-process";
import { whatsappChannelUpdateTask } from "@/worker/tasks/whatsapp-channel-update";
import { attachmentProcessTask } from "@/worker/tasks/attachment-process";

export const taskList = {
  "attachment-process": attachmentProcessTask,
  "agent-run-resume": agentRunResumeTask,
  "agent-team-run": agentTeamRunTask,
  "browser-task-execute": browserTaskExecuteTask,
  "browser-task-resume": browserTaskResumeTask,
  "document-parse": documentParseTask,
  "execution-provision": executionProvisionTask,
  "execution-run-step": executionRunStepTask,
  "execution-collect-artifacts": executionCollectArtifactsTask,
  "execution-cancel": executionCancelTask,
  "execution-cleanup": executionCleanupTask,
  "execution-reconcile": executionReconcileTask,
  "execution-expire": executionExpireTask,
  "operational-tool-execute": operationalToolExecuteTask,
  "notification-dispatch": notificationDispatchTask,
  "telegram-update-process": telegramUpdateProcessTask,
  "whatsapp-channel-update": whatsappChannelUpdateTask,
  "sandbox-create": sandboxCreateTask,
  "sandbox-execute": sandboxExecuteTask,
  "sandbox-resume": sandboxResumeTask,
  "sandbox-reset": sandboxResetTask,
  "sandbox-cleanup": sandboxCleanupTask,
  "sandbox-artifact-cleanup": sandboxCleanupTask,
  "sandbox-health-check": sandboxCleanupTask,
} satisfies TaskList;

export const supportedWorkerTaskNames = Object.freeze(Object.keys(taskList));
