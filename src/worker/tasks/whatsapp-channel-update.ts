import type { Task } from "graphile-worker";
import { processWhatsAppChannelUpdate } from "@/lib/whatsapp/update-processor";
import type { WhatsAppIncomingMessage } from "@/lib/integrations/whatsapp/webhook";
import { whatsappChannelUpdatePayloadSchema } from "@/worker/schemas";

export const whatsappChannelUpdateTask: Task = async (rawPayload, helpers) => {
  const payload = whatsappChannelUpdatePayloadSchema.parse(rawPayload);
  helpers.logger.info(`whatsapp.channel_update started for ${payload.eventRowId}`);
  await processWhatsAppChannelUpdate({
    eventRowId: payload.eventRowId,
    message: payload.message as WhatsAppIncomingMessage,
  });
  helpers.logger.info(`whatsapp.channel_update completed for ${payload.eventRowId}`);
};
