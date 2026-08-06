import type { Task } from "graphile-worker";
import { processTelegramUpdateRow } from "@/lib/telegram/update-processor";
import { telegramUpdateProcessPayloadSchema } from "@/worker/schemas";

export const telegramUpdateProcessTask: Task = async (rawPayload) => {
  const payload = telegramUpdateProcessPayloadSchema.parse(rawPayload);
  await processTelegramUpdateRow(payload);
};
