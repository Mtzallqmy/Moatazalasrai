import type { Task } from "graphile-worker";
import { processCentralTelegramUpdate, type CentralTelegramUpdate } from "@/lib/telegram/update-processor";
import { telegramUpdatePayloadSchema } from "@/worker/schemas";

export const telegramCentralUpdateTask: Task = async (rawPayload, helpers) => {
  const payload = telegramUpdatePayloadSchema.parse(rawPayload);
  helpers.logger.info(`telegram.central_update started for ${payload.updateRowId}`);
  await processCentralTelegramUpdate({
    updateRowId: payload.updateRowId,
    update: payload.update as CentralTelegramUpdate,
  });
  helpers.logger.info(`telegram.central_update completed for ${payload.updateRowId}`);
};
