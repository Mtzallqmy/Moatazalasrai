import type { Task } from "graphile-worker";
import { z } from "zod";
import { processStoredAttachment } from "@/lib/storage/attachments";

const schema = z.object({ organizationId: z.string().uuid(), attachmentId: z.string().uuid() }).strict();

export const attachmentProcessTask: Task = async (rawPayload, helpers) => {
  const payload = schema.parse(rawPayload);
  helpers.logger.info(`attachment.process started for ${payload.attachmentId}`);
  await processStoredAttachment(payload.attachmentId, payload.organizationId);
  helpers.logger.info(`attachment.process completed for ${payload.attachmentId}`);
};
