import type { Task } from "graphile-worker";
import { dispatchNotificationsForEvent } from "@/lib/notifications/dispatch";
import { notificationDispatchPayloadSchema } from "@/worker/schemas";

export const notificationDispatchTask: Task = async (rawPayload, helpers) => {
  const payload = notificationDispatchPayloadSchema.parse(rawPayload);
  helpers.logger.info(`notification.dispatch started for ${payload.eventId}`);
  await dispatchNotificationsForEvent(payload);
  helpers.logger.info(`notification.dispatch completed for ${payload.eventId}`);
};
