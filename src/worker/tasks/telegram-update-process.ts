import type { Task } from "graphile-worker";
import { processTelegramUpdate } from "@/lib/telegram/update-processor";
import { processTelegramChannelUpdate } from "@/lib/telegram/channel-update-processor";
import { telegramUpdatePayloadSchema } from "@/worker/schemas";

export const telegramUpdateProcessTask: Task = async (rawPayload) => {
  const payload = telegramUpdatePayloadSchema.parse(rawPayload);
  if (payload.integrationId && payload.organizationId) {
    await processTelegramChannelUpdate({
      integrationId: payload.integrationId,
      organizationId: payload.organizationId,
      updateRowId: payload.updateRowId,
      update: payload.update,
    });
    return;
  }
  await processTelegramUpdate({
    updateRowId: payload.updateRowId,
    update: payload.update,
  });
};
