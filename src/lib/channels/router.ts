// Central channel router applies identity, routing, permission, handoff, and delivery policy.
import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
} from "drizzle-orm";
import { db } from "@/db";
import {
  channelAgentBindings,
  channelContacts,
  channelConversationLinks,
  channelEvents,
  channelHandoffs,
  channelProviderBindings,
  channelRoutingRules,
  channelWorkflows,
  type ChannelConnectionSettings,
} from "@/db/channel-schema";
import {
  agents,
  attachments,
  auditLogs,
  conversations,
  messages,
  providerCredentials,
  whatsappConnections,
} from "@/db/schema";
import { executeAgentRun } from "@/lib/agents/runtime";
import { ApiError } from "@/lib/http/api";
import type { ProviderContentPart } from "@/lib/providers/types";
import { attachmentContext, storeAttachment } from "@/lib/storage/attachments";
import { channelAdapterContext, channelRoutingPolicy, type ChannelConnectionRow } from "./connections";
import { channelAdapter } from "./registry";
import type {
  ChannelIncomingAttachment,
  ChannelIncomingMessage,
  ChannelOutgoingMessage,
  ChannelRoutingPolicy,
} from "./types";

const HUMAN_REQUEST = /(?:موظف|إنسان|انسان|بشري|خدمة العملاء|الدعم|human|agent|representative)/iu;
const SENSITIVE_OPERATION = /(?:تحويل|دفع|شراء|سحب|إيداع|رصيد|بطاقة|حساب بنكي|password|otp|رمز تحقق|financial|payment)/iu;
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type RouteResult = {
  duplicate?: boolean;
  ignored?: boolean;
  handedOff?: boolean;
  conversationId?: string;
  runId?: string;
  outgoingMessageId?: string;
};

type SelectedRoute = {
  agentId: string | null;
  providerCredentialId: string | null;
  model: string | null;
  forceHandoffReason: string | null;
  workflowId: string | null;
};

function databaseCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "";
}

function safeErrorCode(error: unknown) {
  if (error instanceof ApiError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_.:-]{1,120}$/.test(error.message)) return error.message;
  return error instanceof Error ? error.name.slice(0, 120) : "CHANNEL_PROCESSING_FAILED";
}

function command(text: string, actionId?: string) {
  const value = (actionId || text).trim().toLowerCase();
  const normalized = value.replace(/^\//, "").replace(/^wa\./, "");
  if (["start", "help", "menu", "القائمة", "قائمة", "ابدأ"].includes(normalized)) return "menu";
  if (["new", "جديد", "محادثة جديدة"].includes(normalized)) return "new";
  if (["human", "handoff", "موظف", "بشري", "خدمة العملاء"].includes(normalized)) return "human";
  if (["ai", "الذكاء الاصطناعي", "الوكيل"].includes(normalized)) return "ai";
  if (["status", "الحالة"].includes(normalized)) return "status";
  return null;
}

function sourceForAttachment(kind: ChannelConnectionRow["kind"]) {
  // WhatsApp is recorded in message metadata; attachment enum compatibility is expanded by migration 0032.
  return kind === "telegram" ? "telegram" as const : "api" as const;
}

function extensionForMime(mimeType: string) {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "application/json": ".json",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/mp4": ".m4a",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };
  return map[mimeType] ?? "";
}

function safeFilename(attachment: ChannelIncomingAttachment, downloaded: { filename: string; mimeType: string }) {
  const name = attachment.filename?.trim() || downloaded.filename.trim() || `channel-${attachment.externalId}`;
  return /\.[A-Za-z0-9]{1,10}$/.test(name) ? name : `${name}${extensionForMime(downloaded.mimeType)}`;
}

function partsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    day: String(parts.weekday ?? "").slice(0, 3).toLowerCase(),
    minutes: Number(parts.hour ?? 0) * 60 + Number(parts.minute ?? 0),
  };
}

function minuteOfDay(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function insideBusinessHours(settings: ChannelConnectionSettings, now = new Date()) {
  const schedule = settings.businessHours;
  if (!schedule) return true;
  try {
    const current = partsInTimeZone(now, schedule.timezone);
    const periods = schedule.days[current.day] ?? [];
    return periods.some((period) => {
      const start = minuteOfDay(period.start);
      const end = minuteOfDay(period.end);
      if (start === null || end === null) return false;
      return start <= end
        ? current.minutes >= start && current.minutes < end
        : current.minutes >= start || current.minutes < end;
    });
  } catch {
    return false;
  }
}

async function acceptEvent(connection: ChannelConnectionRow, incoming: ChannelIncomingMessage) {
  try {
    const [event] = await db().insert(channelEvents).values({
      organizationId: connection.organizationId,
      connectionId: connection.id,
      externalEventId: incoming.eventId,
      direction: "incoming",
      eventType: incoming.messageType,
      status: "processing",
      metadata: {
        senderExternalId: incoming.senderExternalId,
        attachmentCount: incoming.attachments.length,
        replyToExternalId: incoming.replyToExternalId ?? null,
      },
      receivedAt: incoming.receivedAt,
    }).returning();
    return event ?? null;
  } catch (error) {
    if (databaseCode(error) === "23505") return null;
    throw error;
  }
}

async function monthlyQuotaAllowed(connection: ChannelConnectionRow, policy: ChannelRoutingPolicy) {
  const limit = policy.settings.monthlyMessageLimit;
  if (!limit || limit < 1) return true;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [usage] = await db().select({ value: count() }).from(channelEvents).where(and(
    eq(channelEvents.organizationId, connection.organizationId),
    eq(channelEvents.connectionId, connection.id),
    eq(channelEvents.direction, "incoming"),
    gte(channelEvents.receivedAt, start),
  ));
  return Number(usage?.value ?? 0) <= limit;
}

async function linkedInternalUser(connection: ChannelConnectionRow, incoming: ChannelIncomingMessage) {
  if (connection.kind !== "whatsapp") return null;
  const [linked] = await db().select({ userId: whatsappConnections.userId }).from(whatsappConnections).where(and(
    eq(whatsappConnections.whatsappWaId, incoming.senderExternalId),
    eq(whatsappConnections.organizationId, connection.organizationId),
    eq(whatsappConnections.connectionStatus, "connected"),
  )).limit(1);
  return linked?.userId ?? null;
}

async function ensureContact(connection: ChannelConnectionRow, incoming: ChannelIncomingMessage) {
  const userId = await linkedInternalUser(connection, incoming);
  const [contact] = await db().insert(channelContacts).values({
    organizationId: connection.organizationId,
    kind: connection.kind,
    externalId: incoming.senderExternalId,
    userId,
    displayName: incoming.senderDisplayName,
    locale: incoming.locale ?? connection.settings.language,
    metadata: { conversationExternalId: incoming.conversationExternalId },
    lastSeenAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [channelContacts.organizationId, channelContacts.kind, channelContacts.externalId],
    set: {
      ...(userId ? { userId } : {}),
      ...(incoming.senderDisplayName ? { displayName: incoming.senderDisplayName } : {}),
      ...(incoming.locale ? { locale: incoming.locale } : {}),
      metadata: { conversationExternalId: incoming.conversationExternalId },
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    },
  }).returning();
  if (!contact) throw new Error("CHANNEL_CONTACT_CREATE_FAILED");
  return contact;
}

async function evaluateRoute(connection: ChannelConnectionRow, incoming: ChannelIncomingMessage): Promise<SelectedRoute> {
  const [agentBindings, providerBindings, rules] = await Promise.all([
    db().select().from(channelAgentBindings).where(and(
      eq(channelAgentBindings.organizationId, connection.organizationId),
      eq(channelAgentBindings.connectionId, connection.id),
      eq(channelAgentBindings.enabled, true),
    )).orderBy(asc(channelAgentBindings.priority)),
    db().select().from(channelProviderBindings).where(and(
      eq(channelProviderBindings.organizationId, connection.organizationId),
      eq(channelProviderBindings.connectionId, connection.id),
      eq(channelProviderBindings.enabled, true),
    )).orderBy(asc(channelProviderBindings.priority)),
    db().select().from(channelRoutingRules).where(and(
      eq(channelRoutingRules.organizationId, connection.organizationId),
      eq(channelRoutingRules.connectionId, connection.id),
      eq(channelRoutingRules.enabled, true),
    )).orderBy(asc(channelRoutingRules.priority)),
  ]);
  let agentId = connection.defaultAgentId ?? agentBindings[0]?.agentId ?? null;
  let providerCredentialId = connection.defaultProviderCredentialId
    ?? agentBindings.find((binding) => binding.agentId === agentId)?.providerCredentialId
    ?? providerBindings[0]?.providerCredentialId
    ?? null;
  let model = connection.defaultModel
    ?? agentBindings.find((binding) => binding.agentId === agentId)?.model
    ?? providerBindings.find((binding) => binding.providerCredentialId === providerCredentialId)?.model
    ?? null;
  let forceHandoffReason: string | null = null;
  let workflowId = connection.workflowId;

  for (const rule of rules) {
    let matches = false;
    if (rule.conditionType === "always") matches = true;
    if (rule.conditionType === "keyword") {
      const keywords = Array.isArray(rule.condition.keywords)
        ? rule.condition.keywords.filter((value): value is string => typeof value === "string")
        : [];
      matches = keywords.some((keyword) => incoming.text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()));
    }
    if (rule.conditionType === "outside_business_hours") {
      matches = !insideBusinessHours(connection.settings, incoming.receivedAt);
    }
    if (!matches) continue;
    if (rule.action === "handoff") forceHandoffReason = rule.name;
    if (rule.action === "route_agent" && typeof rule.actionConfig.agentId === "string") {
      agentId = rule.actionConfig.agentId;
      providerCredentialId = typeof rule.actionConfig.providerCredentialId === "string"
        ? rule.actionConfig.providerCredentialId
        : providerCredentialId;
      model = typeof rule.actionConfig.model === "string" ? rule.actionConfig.model : model;
    }
    if (rule.action === "workflow" && typeof rule.actionConfig.workflowId === "string") {
      workflowId = rule.actionConfig.workflowId;
    }
    break;
  }

  return { agentId, providerCredentialId, model, forceHandoffReason, workflowId };
}

async function validateRoute(connection: ChannelConnectionRow, route: SelectedRoute) {
  if (!route.agentId) return route;
  const [agent] = await db().select({ id: agents.id }).from(agents).where(and(
    eq(agents.id, route.agentId),
    eq(agents.organizationId, connection.organizationId),
    eq(agents.status, "published"),
  )).limit(1);
  if (!agent) throw new ApiError(422, "CHANNEL_AGENT_UNAVAILABLE", "الوكيل المرتبط بالقناة غير منشور أو غير متاح.");
  if (route.providerCredentialId) {
    const [provider] = await db().select({ id: providerCredentials.id, models: providerCredentials.discoveredModels }).from(providerCredentials).where(and(
      eq(providerCredentials.id, route.providerCredentialId),
      eq(providerCredentials.organizationId, connection.organizationId),
      eq(providerCredentials.enabled, true),
      eq(providerCredentials.validationStatus, "verified"),
    )).limit(1);
    if (!provider) throw new ApiError(422, "CHANNEL_PROVIDER_UNAVAILABLE", "المزود المرتبط بالقناة معطل أو غير متحقق.");
    if (route.model && !provider.models.includes(route.model)) {
      throw new ApiError(422, "CHANNEL_MODEL_UNAVAILABLE", "النموذج المرتبط بالقناة غير موجود في المزود المحدد.");
    }
  }
  return route;
}

async function createConversation(connection: ChannelConnectionRow, contact: typeof channelContacts.$inferSelect, agentId: string) {
  const [conversation] = await db().insert(conversations).values({
    organizationId: connection.organizationId,
    agentId,
    title: `${connection.kind === "whatsapp" ? "WhatsApp" : "Telegram"} — ${contact.displayName || contact.externalId}`,
    createdByUserId: contact.userId,
    providerCredentialId: connection.defaultProviderCredentialId,
    model: connection.defaultModel,
    lastMessageAt: new Date(),
  }).returning();
  if (!conversation) throw new Error("CHANNEL_CONVERSATION_CREATE_FAILED");
  return conversation;
}

async function ensureConversationLink(input: {
  connection: ChannelConnectionRow;
  contact: typeof channelContacts.$inferSelect;
  agentId: string;
  forceNew?: boolean;
}) {
  const [existing] = await db().select().from(channelConversationLinks).where(and(
    eq(channelConversationLinks.organizationId, input.connection.organizationId),
    eq(channelConversationLinks.connectionId, input.connection.id),
    eq(channelConversationLinks.contactId, input.contact.id),
  )).limit(1);
  if (existing && !input.forceNew) {
    const [conversation] = await db().select({ id: conversations.id, agentId: conversations.agentId }).from(conversations).where(and(
      eq(conversations.id, existing.conversationId),
      eq(conversations.organizationId, input.connection.organizationId),
    )).limit(1);
    if (conversation && conversation.agentId === input.agentId && existing.status === "active") return existing;
  }
  const conversation = await createConversation(input.connection, input.contact, input.agentId);
  const [link] = await db().insert(channelConversationLinks).values({
    organizationId: input.connection.organizationId,
    connectionId: input.connection.id,
    contactId: input.contact.id,
    conversationId: conversation.id,
    mode: input.connection.settings.handoffMode ?? "ai",
    inboxId: input.connection.inboxId,
    status: "active",
    lastMessageAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [channelConversationLinks.connectionId, channelConversationLinks.contactId],
    set: {
      conversationId: conversation.id,
      mode: input.connection.settings.handoffMode ?? "ai",
      inboxId: input.connection.inboxId,
      assignedUserId: null,
      status: "active",
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    },
  }).returning();
  if (!link) throw new Error("CHANNEL_CONVERSATION_LINK_FAILED");
  return link;
}

async function requestHandoff(input: {
  connection: ChannelConnectionRow;
  link: typeof channelConversationLinks.$inferSelect;
  reason: string;
  requestedBy: "system" | "contact" | "agent" | "user";
}) {
  const [handoff] = await db().insert(channelHandoffs).values({
    organizationId: input.connection.organizationId,
    connectionId: input.connection.id,
    conversationLinkId: input.link.id,
    fromMode: input.link.mode,
    toMode: "human",
    reason: input.reason,
    requestedBy: input.requestedBy,
  }).returning();
  await db().update(channelConversationLinks).set({
    mode: "human",
    inboxId: input.connection.inboxId,
    status: "handoff_requested",
    updatedAt: new Date(),
  }).where(eq(channelConversationLinks.id, input.link.id));
  await db().insert(auditLogs).values({
    organizationId: input.connection.organizationId,
    actorType: "channel",
    actorId: input.requestedBy,
    action: "channel.handoff.requested",
    resourceType: "channel_handoff",
    resourceId: handoff?.id,
    metadata: {
      connectionId: input.connection.id,
      conversationId: input.link.conversationId,
      reason: input.reason,
    },
  });
  return handoff;
}

async function workflowPrompt(organizationId: string, workflowId: string | null, input: string) {
  if (!workflowId) return input;
  const [workflow] = await db().select().from(channelWorkflows).where(and(
    eq(channelWorkflows.id, workflowId),
    eq(channelWorkflows.organizationId, organizationId),
    eq(channelWorkflows.enabled, true),
  )).limit(1);
  if (!workflow) return input;
  const prefix = typeof workflow.config.promptPrefix === "string" ? workflow.config.promptPrefix.trim() : "";
  return prefix ? `${prefix}\n\n${input}` : input;
}

async function downloadAttachments(input: {
  connection: ChannelConnectionRow;
  incoming: ChannelIncomingMessage;
  conversationId: string;
  policy: ChannelRoutingPolicy;
}) {
  if (input.incoming.attachments.length === 0) return { ids: [] as string[], context: "", media: [] as ProviderContentPart[], inputKind: "text" as const };
  if (!input.policy.permissions.has("files.use")) {
    throw new ApiError(403, "CHANNEL_FILES_FORBIDDEN", "لا يملك اتصال القناة صلاحية استخدام الملفات.");
  }
  const adapter = channelAdapter(input.connection.kind);
  const context = await channelAdapterContext(input.connection);
  if (!adapter.downloadAttachment) throw new ApiError(415, "CHANNEL_MEDIA_UNSUPPORTED", "القناة لا تدعم تنزيل هذا النوع من الوسائط.");
  const ids: string[] = [];
  let strongest: "text" | "file" | "image" | "audio" | "video" = "text";
  for (const attachment of input.incoming.attachments) {
    const downloaded = await adapter.downloadAttachment(context, attachment);
    const stored = await storeAttachment({
      organizationId: input.connection.organizationId,
      conversationId: input.conversationId,
      source: sourceForAttachment(input.connection.kind),
      filename: safeFilename(attachment, downloaded),
      mimeType: downloaded.mimeType,
      content: downloaded.content,
      ...(input.connection.kind === "telegram" ? { telegramFileId: attachment.externalId } : {}),
    });
    ids.push(stored.id);
    if (attachment.kind === "video") strongest = "video";
    else if (attachment.kind === "audio" && strongest !== "video") strongest = "audio";
    else if (attachment.kind === "image" && !["video", "audio"].includes(strongest)) strongest = "image";
    else if (strongest === "text") strongest = "file";
  }
  const indexed = await attachmentContext(input.connection.organizationId, input.conversationId, ids);
  const media = indexed.rows.filter((row) => IMAGE_MIME_TYPES.has(row.mimeType)).map((row) => ({
    type: "image" as const,
    mediaType: row.mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
    data: Buffer.from(row.content).toString("base64"),
  }));
  return { ids, context: indexed.text, media, inputKind: strongest };
}

async function sendAndRecord(input: {
  connection: ChannelConnectionRow;
  incoming: ChannelIncomingMessage;
  message: ChannelOutgoingMessage;
  conversationId?: string;
}) {
  const adapter = channelAdapter(input.connection.kind);
  const result = await adapter.send(await channelAdapterContext(input.connection), input.message);
  await db().insert(channelEvents).values({
    organizationId: input.connection.organizationId,
    connectionId: input.connection.id,
    externalEventId: result.externalMessageId,
    direction: "outgoing",
    eventType: input.message.buttons?.length || input.message.list ? "interactive" : "text",
    status: "completed",
    metadata: {
      inReplyTo: input.incoming.eventId,
      conversationId: input.conversationId ?? null,
    },
    completedAt: new Date(),
  }).onConflictDoNothing();
  return result.externalMessageId;
}

async function menu(connection: ChannelConnectionRow, incoming: ChannelIncomingMessage, policy: ChannelRoutingPolicy) {
  const actions = [
    { id: "channel.new", title: "محادثة جديدة" },
    ...(policy.permissions.has("handoff.request") ? [{ id: "channel.human", title: "تحويل لموظف" }] : []),
    { id: "channel.status", title: "حالة القناة" },
  ];
  return sendAndRecord({
    connection,
    incoming,
    message: {
      to: incoming.conversationExternalId,
      text: policy.settings.welcomeMessage || "اختر الإجراء المطلوب.",
      buttons: actions.slice(0, 3),
    },
  });
}

async function processCommand(input: {
  connection: ChannelConnectionRow;
  incoming: ChannelIncomingMessage;
  policy: ChannelRoutingPolicy;
  route: SelectedRoute;
  contact: typeof channelContacts.$inferSelect;
}) {
  const parsed = command(input.incoming.text, input.incoming.interactiveActionId);
  if (!parsed) return null;
  if (!input.policy.allowedCommands.has(parsed) && !["menu", "status"].includes(parsed)) return null;
  if (parsed === "menu") return { outgoingMessageId: await menu(input.connection, input.incoming, input.policy) };
  if (parsed === "status") {
    return {
      outgoingMessageId: await sendAndRecord({
        connection: input.connection,
        incoming: input.incoming,
        message: {
          to: input.incoming.conversationExternalId,
          text: `القناة ${input.connection.enabled ? "مفعلة" : "متوقفة"}. الحالة: ${input.connection.status}. Webhook: ${input.connection.webhookStatus}.`,
        },
      }),
    };
  }
  if (!input.route.agentId) throw new ApiError(422, "CHANNEL_AGENT_REQUIRED", "اربط وكيلًا منشورًا بالقناة أولًا.");
  const link = await ensureConversationLink({
    connection: input.connection,
    contact: input.contact,
    agentId: input.route.agentId,
    forceNew: parsed === "new",
  });
  if (parsed === "human") {
    if (!input.policy.permissions.has("handoff.request")) throw new ApiError(403, "CHANNEL_HANDOFF_FORBIDDEN", "الاتصال لا يملك صلاحية التحويل لموظف.");
    await requestHandoff({ connection: input.connection, link, reason: "contact_requested", requestedBy: "contact" });
    return {
      handedOff: true,
      conversationId: link.conversationId,
      outgoingMessageId: await sendAndRecord({
        connection: input.connection,
        incoming: input.incoming,
        conversationId: link.conversationId,
        message: { to: input.incoming.conversationExternalId, text: "تم تحويل المحادثة إلى الفريق البشري. سيظهر طلبك في صندوق المحادثات." },
      }),
    };
  }
  if (parsed === "ai") {
    await db().update(channelConversationLinks).set({ mode: "ai", status: "active", updatedAt: new Date() })
      .where(eq(channelConversationLinks.id, link.id));
    return {
      conversationId: link.conversationId,
      outgoingMessageId: await sendAndRecord({
        connection: input.connection,
        incoming: input.incoming,
        conversationId: link.conversationId,
        message: { to: input.incoming.conversationExternalId, text: "تم تحويل المحادثة إلى وكيل الذكاء الاصطناعي." },
      }),
    };
  }
  return {
    conversationId: link.conversationId,
    outgoingMessageId: await sendAndRecord({
      connection: input.connection,
      incoming: input.incoming,
      conversationId: link.conversationId,
      message: { to: input.incoming.conversationExternalId, text: "تم إنشاء محادثة جديدة." },
    }),
  };
}

export async function routeIncomingChannelMessage(input: {
  connection: ChannelConnectionRow;
  incoming: ChannelIncomingMessage;
}): Promise<RouteResult> {
  const event = await acceptEvent(input.connection, input.incoming);
  if (!event) return { duplicate: true };
  const adapter = channelAdapter(input.connection.kind);
  try {
    if (!input.connection.enabled || input.connection.status === "disabled") {
      await db().update(channelEvents).set({ status: "ignored", completedAt: new Date() }).where(eq(channelEvents.id, event.id));
      return { ignored: true };
    }
    const policy = await channelRoutingPolicy(input.connection);
    if (!await monthlyQuotaAllowed(input.connection, policy)) {
      throw new ApiError(429, "CHANNEL_MONTHLY_LIMIT_REACHED", "وصل اتصال القناة إلى الحد الشهري للرسائل.");
    }
    if (policy.blockedOperations.has("financial") && SENSITIVE_OPERATION.test(input.incoming.text)) {
      throw new ApiError(403, "CHANNEL_SENSITIVE_OPERATION_BLOCKED", "العمليات الحساسة أو المالية محظورة من هذه القناة.");
    }
    await adapter.markRead?.(await channelAdapterContext(input.connection), input.incoming.eventId).catch(() => undefined);
    const contact = await ensureContact(input.connection, input.incoming);
    const route = await validateRoute(input.connection, await evaluateRoute(input.connection, input.incoming));
    const commandResult = await processCommand({ connection: input.connection, incoming: input.incoming, policy, route, contact });
    if (commandResult) {
      await db().update(channelEvents).set({ status: "completed", completedAt: new Date() }).where(eq(channelEvents.id, event.id));
      return commandResult;
    }
    if (!policy.permissions.has("ai.chat") || !policy.permissions.has("agent.use")) {
      throw new ApiError(403, "CHANNEL_AI_FORBIDDEN", "لا يملك اتصال القناة صلاحية الدردشة مع الذكاء الاصطناعي.");
    }
    if (!route.agentId) throw new ApiError(422, "CHANNEL_AGENT_REQUIRED", "اربط وكيلًا منشورًا بالقناة أولًا.");
    const link = await ensureConversationLink({ connection: input.connection, contact, agentId: route.agentId });
    const requestedHandoff = HUMAN_REQUEST.test(input.incoming.text) && policy.permissions.has("handoff.request");
    const outsideHours = !insideBusinessHours(input.connection.settings, input.incoming.receivedAt);
    const handoffMode = input.connection.settings.handoffMode ?? "ai";
    const forceHuman = Boolean(route.forceHandoffReason)
      || requestedHandoff
      || handoffMode === "human"
      || handoffMode === "human_then_ai"
      || handoffMode === "user_request" && requestedHandoff
      || handoffMode === "business_hours" && outsideHours;
    if (forceHuman || link.mode === "human") {
      if (!policy.permissions.has("handoff.request")) throw new ApiError(403, "CHANNEL_HANDOFF_FORBIDDEN", "الاتصال لا يملك صلاحية التحويل لموظف.");
      await requestHandoff({
        connection: input.connection,
        link,
        reason: route.forceHandoffReason || (requestedHandoff ? "contact_requested" : outsideHours ? "outside_business_hours" : "routing_mode"),
        requestedBy: requestedHandoff ? "contact" : "system",
      });
      const outgoingMessageId = await sendAndRecord({
        connection: input.connection,
        incoming: input.incoming,
        conversationId: link.conversationId,
        message: { to: input.incoming.conversationExternalId, text: "تم توجيه رسالتك إلى الفريق البشري، وستظهر المحادثة في صندوق المتابعة." },
      });
      await db().update(channelEvents).set({ status: "completed", completedAt: new Date() }).where(eq(channelEvents.id, event.id));
      return { handedOff: true, conversationId: link.conversationId, outgoingMessageId };
    }

    const downloaded = await downloadAttachments({
      connection: input.connection,
      incoming: input.incoming,
      conversationId: link.conversationId,
      policy,
    });
    const promptText = input.incoming.text || (downloaded.ids.length ? "حلّل المرفقات الواردة وأجب بما يناسب الطلب." : "مرحبًا");
    const prompt = await workflowPrompt(input.connection.organizationId, route.workflowId, `${promptText}${downloaded.context}`);
    const [userMessage] = await db().insert(messages).values({
      conversationId: link.conversationId,
      role: "user",
      authorUserId: contact.userId,
      content: promptText,
      contentParts: [{ type: "text", text: promptText }],
      status: "completed",
      requestId: input.incoming.eventId,
      clientRequestId: `channel:${input.connection.id}:${input.incoming.eventId}`,
      completedAt: new Date(),
      metadata: {
        source: input.connection.kind,
        channelConnectionId: input.connection.id,
        channelContactId: contact.id,
        externalMessageId: input.incoming.eventId,
        replyToExternalId: input.incoming.replyToExternalId ?? null,
        attachmentIds: downloaded.ids,
      },
    }).returning({ id: messages.id });
    if (userMessage && downloaded.ids.length) {
      await db().update(attachments).set({ messageId: userMessage.id }).where(and(
        eq(attachments.organizationId, input.connection.organizationId),
        inArray(attachments.id, downloaded.ids),
      ));
    }
    const allowedToolIds = policy.permissions.has("tools.execute") ? policy.allowedToolIds : [];
    const completed = await executeAgentRun({
      organizationId: input.connection.organizationId,
      userId: contact.userId ?? undefined,
      conversationAuthorized: true,
      agentId: route.agentId,
      conversationId: link.conversationId,
      message: prompt,
      requestId: `channel:${input.connection.id}:${input.incoming.eventId}`,
      providerCredentialId: route.providerCredentialId ?? undefined,
      model: route.model ?? undefined,
      inputKind: downloaded.inputKind,
      media: downloaded.media,
      allowedToolIds,
    });
    if (!completed.run) throw new Error("CHANNEL_AGENT_RUN_MISSING");
    if (!completed.assistantMessage && completed.approvalId) {
      if (policy.permissions.has("handoff.request")) {
        await requestHandoff({ connection: input.connection, link, reason: "tool_approval_required", requestedBy: "agent" });
      }
      const outgoingMessageId = await sendAndRecord({
        connection: input.connection,
        incoming: input.incoming,
        conversationId: link.conversationId,
        message: { to: input.incoming.conversationExternalId, text: "تحتاج العملية إلى موافقة بشرية. تم إرسالها إلى فريق المتابعة." },
      });
      await db().update(channelEvents).set({ status: "completed", completedAt: new Date() }).where(eq(channelEvents.id, event.id));
      return { handedOff: true, conversationId: link.conversationId, runId: completed.run.id, outgoingMessageId };
    }
    const responseText = completed.assistantMessage?.content ?? completed.run.output ?? "اكتمل الطلب.";
    const outgoingMessageId = await sendAndRecord({
      connection: input.connection,
      incoming: input.incoming,
      conversationId: link.conversationId,
      message: {
        to: input.incoming.conversationExternalId,
        text: responseText,
        replyToExternalId: input.incoming.eventId,
      },
    });
    await db().transaction(async (tx) => {
      await tx.update(channelConversationLinks).set({
        lastExternalMessageId: input.incoming.eventId,
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(channelConversationLinks.id, link.id));
      await tx.update(conversations).set({
        providerCredentialId: route.providerCredentialId,
        model: route.model,
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(conversations.id, link.conversationId),
        eq(conversations.organizationId, input.connection.organizationId),
      ));
      await tx.update(channelEvents).set({ status: "completed", completedAt: new Date() }).where(eq(channelEvents.id, event.id));
      await tx.insert(auditLogs).values({
        organizationId: input.connection.organizationId,
        actorType: "channel",
        actorId: contact.userId ?? contact.id,
        action: "channel.message.routed",
        resourceType: "conversation",
        resourceId: link.conversationId,
        metadata: {
          channel: input.connection.kind,
          connectionId: input.connection.id,
          agentId: route.agentId,
          providerCredentialId: route.providerCredentialId,
          model: route.model,
          runId: completed.run.id,
          allowedToolIds,
          attachmentCount: downloaded.ids.length,
        },
      });
    });
    return {
      conversationId: link.conversationId,
      runId: completed.run.id,
      outgoingMessageId,
    };
  } catch (error) {
    const errorCode = safeErrorCode(error);
    await db().transaction(async (tx) => {
      await tx.update(channelEvents).set({ status: "failed", errorCode, completedAt: new Date() }).where(eq(channelEvents.id, event.id));
      await tx.update(channelConnections).set({ lastErrorCode: errorCode, updatedAt: new Date() })
        .where(eq(channelConnections.id, input.connection.id));
      await tx.insert(auditLogs).values({
        organizationId: input.connection.organizationId,
        actorType: "channel",
        actorId: input.incoming.senderExternalId,
        action: "channel.message.failed",
        resourceType: "channel_connection",
        resourceId: input.connection.id,
        metadata: { eventId: input.incoming.eventId, errorCode },
      });
    });
    const shouldHandoff = input.connection.settings.handoffMode === "agent_failure"
      || input.connection.settings.handoffMode === "ai_then_human";
    if (shouldHandoff) {
      const contact = await ensureContact(input.connection, input.incoming).catch(() => null);
      const route = await evaluateRoute(input.connection, input.incoming).catch(() => null);
      if (contact && route?.agentId) {
        const link = await ensureConversationLink({ connection: input.connection, contact, agentId: route.agentId }).catch(() => null);
        if (link) await requestHandoff({ connection: input.connection, link, reason: `agent_failure:${errorCode}`, requestedBy: "system" }).catch(() => undefined);
      }
    }
    await sendAndRecord({
      connection: input.connection,
      incoming: input.incoming,
      message: {
        to: input.incoming.conversationExternalId,
        text: shouldHandoff
          ? "تعذر إكمال الطلب آليًا، وتم تحويل المحادثة إلى الفريق البشري."
          : `تعذر إكمال الطلب الآن (${errorCode}). حاول مجددًا أو اطلب التحويل لموظف.`,
      },
    }).catch(() => undefined);
    throw error;
  }
}
