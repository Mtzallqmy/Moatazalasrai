import type { Task } from "graphile-worker";
import { resumeBrowserTaskAfterApproval } from "@/lib/browser/resume-runtime";
import { browserResumePayloadSchema } from "@/worker/schemas";

export const browserTaskResumeTask: Task = async (rawPayload, helpers) => {
  const payload = browserResumePayloadSchema.parse(rawPayload);
  const task = await resumeBrowserTaskAfterApproval(payload);
  helpers.logger.info(`browser-task-resume finished with status ${task?.status ?? "unknown"}`);
};
