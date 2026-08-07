import { getUsableChannelAgent } from "@/lib/agents/application-service";
import { ensureCentralTelegramChannelConnection } from "@/lib/channels/connections";
import { routeIncomingChannelMessage } from "@/lib/channels/router";
import { telegramChannelAdapter } from "@/lib/channels/telegram-adapter";
import { assertUserPermission } from "@/lib/auth/user-authorization";
import { ApiError } from "@/lib/http/api";
import { sendTelegramChatAction } from "@/lib/integrations/telegram";
import {
  centralTelegramBot,
  telegramFeatureAllowed,
  type TelegramFeatureKey,
} from "@/lib/integrations/telegram-platform";
import { listTelegramAgents } from "./agent-flows";
import { sendTelegramError } from "./message-renderer";
import { getTelegramSession, setTelegramConversation } from "./session-service";
import type { TelegramUpdate } from "./update-parser";

type MediaContext = {
  token: string;
  chatId: string;
  telegramUserId: string;
  userId: string;
  organizationId: string;
  update: TelegramUpdate;
  requestId: string;
};

function mediaFeature(update: TelegramUpdate): { key: TelegramFeatureKey; label: string; action: "upload_document" | "upload_photo" | "record_voice" | "upload_video" } | null {
  const message = update.message ?? update.edited_message;
  if (!message) return null;
  if (message.document) return { key: "telegram.files", label: "الملفات", action: "upload_document" };
  if (message.photo?.length) return { key: "telegram.images", label: "الصور", action: "upload_photo" };
  if (message.audio || message.voice) return { key: "telegram.audio", label: "الصوت", action: "record_voice" };
  if (message.video) return { key: "telegram.video", label: "الفيديو", action: "upload_video" };
  return null;
}

export async function handleTelegramMedia(input: MediaContext) {
  const feature = mediaFeature(input.update);
  if (!feature) return false;
  await assertUserPermission({
    userId: input.userId,
    organizationId: input.organizationId,
    permission: "files:upload",
  });
  const [mediaAllowed, chatAllowed] = await Promise.all([
    telegramFeatureAllowed(input.userId, input.organizationId, feature.key),
    telegramFeatureAllowed(input.userId, input.organizationId, "telegram.chat"),
  ]);
  if (!mediaAllowed) {
    throw new ApiError(403, "TELEGRAM_MEDIA_FEATURE_DENIED", `ميزة ${feature.label} غير مفعلة لحسابك في Telegram.`);
  }
  if (!chatAllowed) {
    throw new ApiError(403, "TELEGRAM_CHAT_FEATURE_DENIED", "الدردشة غير مفعلة لحسابك في Telegram.");
  }

  const session = await getTelegramSession(input.telegramUserId);
  if (!session?.selectedAgentId) {
    await listTelegramAgents({ ...input, mode: "select" });
    return true;
  }
  const agent = await getUsableChannelAgent({
    organizationId: input.organizationId,
    userId: input.userId,
    agentId: session.selectedAgentId,
  });
  const bot = await centralTelegramBot();
  const centralConnection = await ensureCentralTelegramChannelConnection({
    organizationId: input.organizationId,
    botId: String(bot.id),
    botUsername: bot.username,
    actorUserId: input.userId,
  });
  const connection = {
    ...centralConnection,
    defaultAgentId: agent.id,
    defaultProviderCredentialId: agent.providerCredentialId,
    defaultModel: agent.model,
  };
  const normalized = telegramChannelAdapter.normalizeIncoming(input.update, {
    externalAccountId: String(bot.id),
  });
  if (!normalized.length || !normalized.some((message) => message.attachments.length > 0)) {
    throw new ApiError(422, "TELEGRAM_MEDIA_INVALID", "لم يتم العثور على ملف أو وسيط صالح في الرسالة.");
  }

  await sendTelegramChatAction({ token: input.token, chatId: input.chatId, action: feature.action }).catch(() => undefined);
  for (const incoming of normalized) {
    const result = await routeIncomingChannelMessage({ connection, incoming });
    if (result.conversationId) {
      await setTelegramConversation({
        telegramUserId: input.telegramUserId,
        agentId: agent.id,
        conversationId: result.conversationId,
      });
    }
  }
  return true;
}

export async function presentTelegramMediaFailure(input: {
  token: string;
  chatId: string;
  error: unknown;
  referenceId: string;
}) {
  const messages: Record<string, string> = {
    FILE_TOO_LARGE: "حجم الملف يتجاوز الحد المسموح وهو 20 ميجابايت.",
    TELEGRAM_FILE_INVALID: "تعذر تحديد ملف Telegram بصورة آمنة.",
    TELEGRAM_FILE_DOWNLOAD_FAILED: "تعذر تنزيل الملف من Telegram مؤقتًا.",
    FILE_MIME_NOT_ALLOWED: "نوع الملف غير مدعوم.",
    FILE_SIGNATURE_INVALID: "محتوى الملف لا يطابق نوعه المعلن.",
    TELEGRAM_MEDIA_FEATURE_DENIED: "نوع الوسائط المرسل غير مفعّل لحسابك.",
  };
  const code = input.error instanceof ApiError ? input.error.code : "TELEGRAM_MEDIA_PROCESSING_FAILED";
  await sendTelegramError({
    token: input.token,
    chatId: input.chatId,
    text: messages[code] ?? (input.error instanceof ApiError ? input.error.message : "تعذر معالجة الوسيط حاليًا."),
    referenceId: input.referenceId,
    buttonRows: [[{ id: "nav:home", title: "الرئيسية" }]],
  });
}
