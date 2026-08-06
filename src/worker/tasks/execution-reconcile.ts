import type { Task } from "graphile-worker";
import { reconcileExecutions } from "@/lib/execution/worker-runtime";
import { executionMaintenancePayloadSchema } from "@/worker/schemas";

export const executionReconcileTask: Task = async (rawPayload, helpers) => {
  executionMaintenancePayloadSchema.parse(rawPayload);
  const result = await reconcileExecutions(`execution-reconcile:${process.pid}`);
  helpers.logger.info(`execution-reconcile scanned ${result.scanned}`);
};
