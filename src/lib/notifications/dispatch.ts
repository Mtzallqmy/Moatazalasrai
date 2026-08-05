import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { channelConnections } from "@/db/channel-schema";
import {
  domainEvents,
  internalNotifications,
  notificationDeliveries,
  notificationRules,
  notificationTemplates,
  type NotificationChannel,
} from "@/db/control-plane-schema";
import { auditLogs, organizationMembers, users, whatsappConnections } from "@/db/schema";
import { channelAdapterContext } from "@/lib/channels/connections";
import { channelAdapter } from "@/lib/channels/registry";
import { sendWhatsAppTemplate } from "@/lib/integrations/whatsapp/template-client";
import { renderNotificationTemplate } from "@/lib/notifications/render";

export type NotificationRecipient = {
  key: string;
  userId?: string;
  email?: string;
  phone?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readPath(values: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, values);
}

async function recipientsForRule(input: {
  organizationId: string;
  audienceType: string;
  audienceConfig: Record<string, unknown>;
  payload: Record<string, unknown>;
}): Promise<NotificationRecipient[]> {
  if (input.audienceType === "owners") {
    const rows = await db().select({ id: users.id, email: users.email }).from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(
        eq(organizationMembers.organizationId, input.organizationId),
        inArray(organizationMembers.role, ["owner", "admin"]),
      ));
    return rows.map((row) => ({ key: `user:${row.id}`, userId: row.id, email: row.email }));
  }

  if (input.audienceType === "explicit") {
    const rows = Array.isArray(input.audienceConfig.recipients) ? input.audienceConfig.recipients : [];
    return rows.flatMap((value): NotificationRecipient[] => {
      const item = record(value);
      const userId = typeof item.userId === "string" ? item.userId : undefined;
      const email = typeof item.email === "string" ? item.email : undefined;
      const phone = typeof item.phone === "string" ? item.phone : undefined;
      const key = userId ? `user:${userId}` : phone ? `phone:${phone}` : email ? `email:${email}` : "";
      return key ? [{ key, userId, email, phone }] : [];
    });
  }

  const userId = typeof input.payload.userId === "string" ? input.payload.userId : undefined;
  if (userId) {
    const [user] = await db().select({ id: users.id, email: users.email })
      .from(users).where(eq(users.id, userId)).limit(1);
    if (user) return [{ key: `user:${user.id}`, userId: user.id, email: user.email }];
  }

  const phone = typeof input.payload.whatsappWaId === "string" ? input.payload.whatsappWaId : undefined;
  return phone ? [{ key: `phone:${phone}`, phone }] : [];
}

async function phoneFor(recipient: NotificationRecipient) {
  if (recipient.phone) return recipient.phone;
  if (!recipient.userId) return null;
  const [connection] = await db().select({ waId: whatsappConnections.whatsappWaId })
    .from(whatsappConnections)
    .where(and(
      eq(whatsappConnections.userId, recipient.userId),
      eq(whatsappConnections.connectionStatus, "connected"),
    ))
    .limit(1);
  return connection?.waId ?? null;
}

async function whatsappConnection(organizationId: string, requestedConnectionId?: string) {
  if (requestedConnectionId) {
    const [connection] = await db().select().from(channelConnections).where(and(
      eq(channelConnections.id, requestedConnectionId),
      eq(channelConnections.organizationId, organizationId),
      eq(channelConnections.kind, "whatsapp"),
      eq(channelConnections.enabled, true),
    )).limit(1);
    return connection ?? null;
  }
  const [connection] = await db().select().from(channelConnections).where(and(
    eq(channelConnections.organizationId, organizationId),
    eq(channelConnections.kind, "whatsapp"),
    eq(channelConnections.enabled, true),
  )).orderBy(asc(channelConnections.createdAt)).limit(1);
  return connection ?? null;
}

async function sendWhatsApp(input: {
  organizationId: string;
  recipient: NotificationRecipient;
  text: string;
  variables: string[];
  values: Record<string, unknown>;
  templateName: string | null;
  locale: string;
  audienceConfig: Record<string, unknown>;
}) {
  const phone = await phoneFor(input.recipient);
  if (!phone) throw new Error("WHATSAPP_RECIPIENT_NOT_LINKED");
  const requestedConnectionId = typeof input.audienceConfig.connectionId === "string"
    ? input.audienceConfig.connectionId
    : undefined;
  const connection = await whatsappConnection(input.organizationId, requestedConnectionId);
  if (!connection) throw new Error("WHATSAPP_CHANNEL_UNAVAILABLE");
  const context = await channelAdapterContext(connection);
  if (context.credentials.kind !== "whatsapp") throw new Error("WHATSAPP_CREDENTIALS_REQUIRED");

  if (input.templateName) {
    const result = await sendWhatsAppTemplate({
      to: phone,
      templateName: input.templateName,
      languageCode: input.locale,
      parameters: input.variables.map((key) => {
        const value = readPath(input.values, key);
        return value === undefined || value === null ? "" : String(value);
      }),
      config: {
        appId: "managed-connection",
        appSecret: "managed-connection",
        graphApiVersion: context.credentials.graphApiVersion,
        accessToken: context.credentials.accessToken,
        phoneNumberId: context.credentials.phoneNumberId,
        businessAccountId: "managed-connection",
        displayPhoneNumber: connection.displayAddress ?? connection.externalAccountId,
        webhookVerifyToken: "managed-connection",
        connectTokenSecret: "managed-connection",
        connectTokenTtlMinutes: 15,
        publicAppUrl: "https://managed.invalid",
      },
    });
    return result.messageId;
  }

  const result = await channelAdapter("whatsapp").send(context, { to: phone, text: input.text });
  return result.externalMessageId;
}

export async function dispatchNotificationsForEvent(input: {
  organizationId: string;
  eventId: string;
}) {
  const [event] = await db().select().from(domainEvents).where(and(
    eq(domainEvents.id, input.eventId),
    eq(domainEvents.organizationId, input.organizationId),
  )).limit(1);
  if (!event) throw new Error("DOMAIN_EVENT_NOT_FOUND");

  const rows = await db().select({ rule: notificationRules, template: notificationTemplates })
    .from(notificationRules)
    .innerJoin(notificationTemplates, eq(notificationTemplates.id, notificationRules.templateId))
    .where(and(
      eq(notificationRules.organizationId, input.organizationId),
      eq(notificationRules.eventKey, event.eventKey),
      eq(notificationRules.enabled, true),
      eq(notificationTemplates.enabled, true),
      isNull(notificationTemplates.deletedAt),
    ))
    .orderBy(asc(notificationRules.priority), asc(notificationRules.createdAt));

  const values: Record<string, unknown> = {
    ...event.payload,
    event: { id: event.id, key: event.eventKey, occurredAt: event.occurredAt.toISOString() },
  };

  for (const row of rows) {
    const recipients = await recipientsForRule({
      organizationId: input.organizationId,
      audienceType: row.rule.audienceType,
      audienceConfig: row.rule.audienceConfig,
      payload: event.payload,
    });

    for (const recipient of recipients) {
      let [delivery] = await db().insert(notificationDeliveries).values({
        organizationId: input.organizationId,
        eventId: event.id,
        ruleId: row.rule.id,
        templateId: row.template.id,
        channel: row.rule.channel,
        recipient: recipient.key,
        payload: { recipient, eventKey: event.eventKey },
      }).onConflictDoNothing().returning();

      if (!delivery) {
        [delivery] = await db().select().from(notificationDeliveries).where(and(
          eq(notificationDeliveries.eventId, event.id),
          eq(notificationDeliveries.ruleId, row.rule.id),
          eq(notificationDeliveries.recipient, recipient.key),
        )).limit(1);
      }
      if (!delivery || ["sent", "delivered", "read", "skipped"].includes(delivery.status)) continue;

      const subject = row.template.subject
        ? renderNotificationTemplate(row.template.subject, values, row.template.variables)
        : row.template.name;
      const body = renderNotificationTemplate(row.template.body, values, row.template.variables);
      await db().update(notificationDeliveries).set({
        status: "processing",
        attempts: delivery.attempts + 1,
        lastErrorCode: null,
        updatedAt: new Date(),
      }).where(eq(notificationDeliveries.id, delivery.id));

      try {
        let providerMessageId: string | null = null;
        const channel = row.rule.channel as NotificationChannel;
        if (channel === "internal") {
          if (!recipient.userId) throw new Error("INTERNAL_NOTIFICATION_USER_REQUIRED");
          const [created] = await db().insert(internalNotifications).values({
            organizationId: input.organizationId,
            userId: recipient.userId,
            deliveryId: delivery.id,
            title: subject,
            body,
            metadata: { eventId: event.id, eventKey: event.eventKey },
          }).returning({ id: internalNotifications.id });
          providerMessageId = created?.id ?? null;
        } else if (channel === "whatsapp") {
          providerMessageId = await sendWhatsApp({
            organizationId: input.organizationId,
            recipient,
            text: body,
            variables: row.template.variables,
            values,
            templateName: row.template.whatsappTemplateName,
            locale: row.template.locale,
            audienceConfig: row.rule.audienceConfig,
          });
        } else {
          throw new Error(`${channel.toUpperCase()}_PROVIDER_NOT_CONFIGURED`);
        }

        await db().update(notificationDeliveries).set({
          status: "sent",
          providerMessageId,
          sentAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(notificationDeliveries.id, delivery.id));
      } catch (error) {
        const errorCode = error instanceof Error
          ? error.message.slice(0, 160)
          : "NOTIFICATION_DELIVERY_FAILED";
        await db().update(notificationDeliveries).set({
          status: "failed",
          lastErrorCode: errorCode,
          updatedAt: new Date(),
        }).where(eq(notificationDeliveries.id, delivery.id));
        if (row.rule.channel === "whatsapp" && delivery.attempts + 1 < delivery.maxAttempts) throw error;
      }
    }
  }

  await db().update(domainEvents).set({ processedAt: new Date() }).where(eq(domainEvents.id, event.id));
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "system",
    action: "notifications.event.processed",
    resourceType: "domain_event",
    resourceId: event.id,
    metadata: { eventKey: event.eventKey, ruleCount: rows.length },
  });
}
