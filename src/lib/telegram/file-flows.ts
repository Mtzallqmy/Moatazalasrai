import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { assertActorPermission } from "@/lib/auth/actor-authorization";
import { getWritableConversation } from "@/lib/chat/service";
import { ApiError } from "@/lib/http/api";
import { telegramFeatureAllowed, type TelegramFeatureKey } from "@/lib/integrations/telegram-platform";
import { MAX_ATTACHMENT_BYTES, storeAttachment } from "@/lib/storage/attachments";
import { telegramDownload } from "@/lib/telegram/client";
import { handleConversationText } from "@/lib/telegram/conversation-flows";
import {
  sendTelegramEmptyState,
  sendTelegramList,
  sendTelegramText,
} from "@/lib/telegram/message-renderer";
import type { TelegramActionContext } from "@/lib/telegram/types";
import type { TelegramIncomingAttachment } from "@/lib/telegram/update-parser";

function featureFor(kind: TelegramIncomingAttachment["kind"]): TelegramFeatureKey {
  if (kind === "image") return "telegram.images";
  if (kind === "audio") return "telegram.audio";
  if (kind === "video") return "telegram.video";
  return "telegram.files";
}

function safeFilename(attachment: TelegramIncomingAttachment, filePath: string) {
  const candidate = attachment.filename?.trim() || filePath.split("/").at(-1)?.trim();
  if (!candidate || candidate.includes("..") || candidate.includes("/") || candidate.includes("\\")) {
    return `telegram-${attachment.fileId.slice(0, 24)}`;
  }
  return candidate.slice(0, 255);
}

async function assertAttachmentAllowed(context: TelegramActionContext, attachment: TelegramIncomingAttachment) {
  await assertActorPermission(context.actor, "files:upload");
  const feature = featureFor(attachment.kind);
  const allowed = await telegramFeatureAllowed(context.actor.userId, context.actor.organizationId, feature);
  if (!allowed) throw new ApiError(403, "TELEGRAM_FEATURE_FORBIDDEN", `ميزة ${feature} غير مفعلة لحسابك.`);
  if (attachment.sizeBytes && attachment.sizeBytes > MAX_ATTACHMENT_BYTES) {
    throw new ApiError(413, "FILE_TOO_LARGE", "حجم الملف المعلن يتجاوز الحد المسموح.");
  }
}

export async function handleIncomingAttachments(context: TelegramActionContext) {
  if (!context.update.attachments.length) return false;
  if (!context.session.selectedConversationId || context.session.activeFlow !== "conversation.chat") {
    await sendTelegramEmptyState({
      chatId: context.update.chatId,
      title: "إرسال ملف إلى وكيل",
      text: "ابدأ محادثة حقيقية واختر وكيلًا أولًا. لم يتم تنزيل الملف أو اعتباره مخزنًا.",
      buttonRows: [[{ id: "chat:open", title: "فتح المحادثة" }], [{ id: "nav:home", title: "الرئيسية" }]],
    });
    return true;
  }
  await getWritableConversation({ actor: context.actor, conversationId: context.session.selectedConversationId });
  for (const attachment of context.update.attachments) await assertAttachmentAllowed(context, attachment);
  await sendTelegramText({ chatId: context.update.chatId, text: "جارٍ تنزيل المرفق والتحقق منه وتخزينه…" });
  const storedIds: string[] = [];
  for (const attachment of context.update.attachments) {
    const downloaded = await telegramDownload(attachment.fileId);
    if (!downloaded.content.length) throw new ApiError(422, "FILE_CONTENT_UNAVAILABLE", "الملف الذي أعاده Telegram فارغ.");
    if (downloaded.content.length > MAX_ATTACHMENT_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", "حجم الملف بعد التنزيل يتجاوز الحد المسموح.");
    const stored = await storeAttachment({
      organizationId: context.actor.organizationId,
      conversationId: context.session.selectedConversationId,
      uploadedByUserId: context.actor.userId,
      source: "telegram",
      filename: safeFilename(attachment, downloaded.filePath),
      mimeType: attachment.mimeType?.trim() || "application/octet-stream",
      content: downloaded.content,
      telegramFileId: attachment.fileId,
    });
    storedIds.push(stored.id);
  }
  await sendTelegramText({
    chatId: context.update.chatId,
    text: `تم تخزين ${storedIds.length === 1 ? "المرفق" : `${storedIds.length} مرفقات`} وربطه بالمحادثة بنجاح. ستبدأ معالجة الوكيل الآن.`,
  });
  const caption = context.update.text.trim();
  await handleConversationText(context, caption || "حلل المرفق المرسل واذكر النتيجة بوضوح.", storedIds);
  return true;
}

export async function renderFiles(context: TelegramActionContext) {
  await assertActorPermission(context.actor, "files:read");
  const page = Math.max(1, context.page);
  const limit = 6;
  const ownOnly = context.actor.role === "member";
  const where = and(
    eq(attachments.organizationId, context.actor.organizationId),
    ownOnly ? eq(attachments.uploadedByUserId, context.actor.userId) : undefined,
    isNull(attachments.deletedAt),
    isNull(attachments.archivedAt),
  );
  const [rows, totalRows] = await Promise.all([
    db().select({
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      processingStatus: attachments.processingStatus,
      createdAt: attachments.createdAt,
    }).from(attachments).where(where).orderBy(desc(attachments.createdAt)).limit(limit).offset((page - 1) * limit),
    db().select({ value: count() }).from(attachments).where(where),
  ]);
  const total = Number(totalRows[0]?.value ?? 0);
  const pages = Math.ceil(total / limit);
  const pager = [] as Array<{ id: string; title: string }>;
  if (page > 1) pager.push({ id: `cap:files.list:${page - 1}`, title: "السابق" });
  if (page < pages) pager.push({ id: `cap:files.list:${page + 1}`, title: "التالي" });
  return sendTelegramList({
    chatId: context.update.chatId,
    messageId: context.update.kind === "callback_query" ? context.update.messageId : undefined,
    path: "الرئيسية ← المحتوى والمعرفة ← الملفات",
    title: `الملفات الفعلية — صفحة ${page} من ${Math.max(1, pages)}`,
    items: rows.map((file, index) => `${(page - 1) * limit + index + 1}. ${file.filename}\nالنوع: ${file.mimeType}\nالحجم: ${file.sizeBytes} بايت\nالمعالجة: ${file.processingStatus}\nأضيف: ${file.createdAt.toISOString()}`),
    emptyText: "لا توجد ملفات متاحة. ابدأ محادثة ثم أرسل ملفًا أو صورة أو صوتًا أو فيديو مدعومًا.",
    buttonRows: [
      ...(pager.length ? [pager] : []),
      [{ id: "chat:open", title: "فتح محادثة لإرسال ملف" }],
      [{ id: "nav:home", title: "الرئيسية" }, { id: `cap:files.list:${page}`, title: "تحديث" }],
    ],
  });
}
