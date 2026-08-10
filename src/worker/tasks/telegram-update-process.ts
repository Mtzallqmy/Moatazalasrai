import type { Task } from "graphile-worker";
import { processTelegramChannelUpdate } from "@/lib/telegram/channel-update-processor";
import { telegramUpdatePayloadSchema } from "@/worker/schemas";

export const telegramUpdateProcessTask: Task = async (rawPayload) => {
  const payload = telegramUpdatePayloadSchema.parse(rawPayload);
  if (!payload.integrationId || !payload.organizationId) {
    throw new Error("TELEGRAM_INTEGRATION_CONTEXT_REQUIRED");
  }
  await processTelegramChannelUpdate({
    integrationId: payload.integrationId,
    organizationId: payload.organizationId,
    updateRowId: payload.updateRowId,
    update: payload.update,
  });
};
