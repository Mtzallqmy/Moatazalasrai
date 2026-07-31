import type { TaskList } from "graphile-worker";
import { agentRunResumeTask } from "@/worker/tasks/agent-run-resume";
import { agentTeamRunTask } from "@/worker/tasks/agent-team-run";
import { documentParseTask } from "@/worker/tasks/document-parse";

export const taskList = {
  "agent-run-resume": agentRunResumeTask,
  "agent-team-run": agentTeamRunTask,
  "document-parse": documentParseTask,
} satisfies TaskList;

export const supportedWorkerTaskNames = Object.freeze(Object.keys(taskList));
