import type { Task } from "graphile-worker";
import { telegramUpdatePayloadSchema } from "@/worker/schemas";
import { processTelegramUpdate } from "@/lib/telegram/update-processor";

export const telegramUpdateProcessTask: Task = async (rawPayload) => {
  const payload = telegramUpdatePayloadSchema.parse(rawPayload);
  await processTelegramUpdate({
    updateRowId: payload.updateRowId,
    update: payload.update,
  });
};
