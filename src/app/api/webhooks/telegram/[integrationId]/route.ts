import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  agents,
  attachments,
  conversations,
  integrations,
  messages,
  telegramChats,
  telegramUpdates,
} from "@/db/schema";
import { executeAgentRun } from "@/lib/agents/runtime";
import { apiSuccess, getRequestId } from "@/lib/http/api";
import { listGitHubRepositories, readGitHubFile } from "@/lib/integrations/github";
import {
  downloadTelegramFile,
  sendTelegramMessage,
} from "@/lib/integrations/telegram";
import { decryptSecret, secureHashEquals } from "@/lib/security/encryption";
import { storeAttachment } from "@/lib/storage/attachments";
import { attachmentContext } from "@/lib/storage/attachments";

export const runtime = "nodejs";

type TelegramMessage = {
  message_id?: number;
  text?: string;
  caption?: string;
  chat?: { id?: number; username?: string; title?: string; first_name?: string };
  document?: { file_id?: string; file_name?: string; mime_type?: string; file_size?: number };
  photo?: Array<{ file_id?: string; file_size?: number; width?: number; height?: number }>;
};

type TelegramUpdate = { update_id?: number; message?: TelegramMessage };

function telegramFile(message: TelegramMessage) {
  if (message.document?.file_id) {
    return {
      fileId: message.document.file_id,
      filename: message.document.file_name ?? "telegram-file",
      mimeType: message.document.mime_type ?? "application/octet-stream",
    };
  }
  const photo = message.photo?.at(-1);
  return photo?.file_id
    ? { fileId: photo.file_id, filename: `telegram-${message.message_id ?? "photo"}.jpg`, mimeType: "image/jpeg" }
    : null;
}

async function ensureTelegramConversation(input: {
  integrationId: string;
  organizationId: string;
  agentId: string;
  chatId: string;
  username?: string;
  title?: string;
  forceNew?: boolean;
}) {
  const [existing] = await db().select().from(telegramChats).where(and(
    eq(telegramChats.integrationId, input.integrationId),
    eq(telegramChats.telegramChatId, input.chatId),
  )).limit(1);
  if (existing?.conversationId && !input.forceNew && existing.agentId === input.agentId) {
    await db().update(telegramChats).set({
      username: input.username,
      title: input.title,
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(telegramChats.id, existing.id));
    return existing.conversationId;
  }
  const [agent] = await db().select({ name: agents.name }).from(agents).where(and(
    eq(agents.id, input.agentId),
    eq(agents.organizationId, input.organizationId),
    eq(agents.status, "published"),
  )).limit(1);
  if (!agent) throw new Error("TELEGRAM_AGENT_UNAVAILABLE");
  const [conversation] = await db().insert(conversations).values({
    organizationId: input.organizationId,
    agentId: input.agentId,
    title: `Telegram — ${input.title || input.username || input.chatId}`,
  }).returning({ id: conversations.id });
  if (!conversation) throw new Error("TELEGRAM_CONVERSATION_CREATE_FAILED");
  await db().insert(telegramChats).values({
    organizationId: input.organizationId,
    integrationId: input.integrationId,
    telegramChatId: input.chatId,
    conversationId: conversation.id,
    agentId: input.agentId,
    username: input.username,
    title: input.title,
    lastMessageAt: new Date(),
  }).onConflictDoUpdate({
    target: [telegramChats.integrationId, telegramChats.telegramChatId],
    set: {
      conversationId: conversation.id,
      agentId: input.agentId,
      username: input.username,
      title: input.title,
      enabled: true,
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return conversation.id;
}

async function githubCommand(organizationId: string, command: string) {
  const [github] = await db().select().from(integrations).where(and(
    eq(integrations.organizationId, organizationId),
    eq(integrations.kind, "github"),
    eq(integrations.enabled, true),
    eq(integrations.status, "verified"),
  )).limit(1);
  if (!github) return "لم يُفعّل تكامل GitHub لهذه المؤسسة.";
  const token = decryptSecret(github.encryptedToken, `integration:${organizationId}`);
  const readMatch = command.match(/^\/github\s+read\s+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\s+(\S+)(?:\s+(\S+))?$/);
  if (readMatch) {
    const [, owner, repo, path, ref] = readMatch;
    const file = await readGitHubFile(token, owner, repo, path, ref);
    if (!file.content) return `الملف ${file.path} لا يحتوي نصًا قابلًا للعرض.`;
    const content = file.encoding === "base64"
      ? Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8")
      : file.content;
    return `${file.path} @ ${file.sha.slice(0, 8)}\n\n${content.slice(0, 3500)}`;
  }
  const repositories = await listGitHubRepositories(token, 15);
  if (repositories.length === 0) return "لا توجد مستودعات متاحة للتوكن الحالي.";
  return repositories.map((repo, index) =>
    `${index + 1}. ${repo.full_name} — ${repo.private ? "خاص" : "عام"} — ${repo.default_branch}`,
  ).join("\n");
}

async function processUpdate(input: {
  integration: typeof integrations.$inferSelect;
  update: TelegramUpdate;
  updateRowId: string;
}) {
  const token = decryptSecret(input.integration.encryptedToken, `integration:${input.integration.organizationId}`);
  const message = input.update.message;
  const chatIdValue = message?.chat?.id;
  if (!message || chatIdValue === undefined) {
    await db().update(telegramUpdates).set({ status: "ignored", completedAt: new Date() })
      .where(eq(telegramUpdates.id, input.updateRowId));
    return;
  }
  const chatId = String(chatIdValue);
  try {
    const text = (message.text ?? message.caption ?? "").trim();
    if (text === "/start" || text === "/help") {
      await sendTelegramMessage({
        token,
        chatId,
        text: "مرحبًا بك في منصة معتز.\n\nأرسل رسالة للدردشة مع الوكيل.\n/new لبدء محادثة جديدة.\n/github repos لعرض المستودعات.\n/github read owner/repo path [ref] لقراءة ملف.\n/status لفحص حالة الربط.",
      });
    } else if (text === "/status") {
      await sendTelegramMessage({ token, chatId, text: "✅ Telegram متصل والمنصة جاهزة لاستقبال الرسائل." });
    } else if (text === "/github repos" || text.startsWith("/github read ")) {
      await sendTelegramMessage({
        token,
        chatId,
        text: await githubCommand(input.integration.organizationId, text),
      });
    } else {
      const agentId = typeof input.integration.config.agentId === "string"
        ? input.integration.config.agentId
        : null;
      if (!agentId) {
        await sendTelegramMessage({ token, chatId, text: "اختر وكيلًا منشورًا لهذا البوت من صفحة التكاملات أولًا." });
      } else {
        const forceNew = text === "/new";
        const conversationId = await ensureTelegramConversation({
          integrationId: input.integration.id,
          organizationId: input.integration.organizationId,
          agentId,
          chatId,
          username: message.chat?.username,
          title: message.chat?.title ?? message.chat?.first_name,
          forceNew,
        });
        if (forceNew) {
          await sendTelegramMessage({ token, chatId, text: "تم إنشاء محادثة جديدة." });
        } else {
          const file = telegramFile(message);
          const attachmentIds: string[] = [];
          if (file) {
            const downloaded = await downloadTelegramFile(token, file.fileId);
            const stored = await storeAttachment({
              organizationId: input.integration.organizationId,
              conversationId,
              source: "telegram",
              filename: file.filename,
              mimeType: file.mimeType,
              content: downloaded.content,
              telegramFileId: file.fileId,
            });
            attachmentIds.push(stored.id);
          }
          const indexed = await attachmentContext(input.integration.organizationId, conversationId, attachmentIds);
          const media = indexed.rows.filter((item) => ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(item.mimeType)).map((item) => ({
            type: "image" as const,
            mediaType: item.mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
            data: Buffer.from(item.content).toString("base64"),
          }));
          const promptText = text || "حلّل الملف المرفق واذكر ما وجدته فيه.";
          const [userMessage] = await db().insert(messages).values({
            conversationId, role: "user", content: promptText,
            metadata: { source: "telegram", attachmentIds, telegramMessageId: message.message_id },
          }).returning({ id: messages.id });
          if (userMessage && attachmentIds.length) {
            await db().update(attachments).set({ messageId: userMessage.id }).where(and(
              eq(attachments.organizationId, input.integration.organizationId),
              eq(attachments.id, attachmentIds[0]!),
            ));
          }
          const prompt = `${promptText}${indexed.text}`;
          const completed = await executeAgentRun({
            organizationId: input.integration.organizationId,
            agentId,
            conversationId,
            message: prompt,
            media,
          });
          await sendTelegramMessage({
            token,
            chatId,
            text: completed.assistantMessage?.content ?? completed.run?.output ?? "اكتمل التشغيل.",
          });
        }
      }
    }
    await db().update(telegramUpdates).set({ status: "completed", completedAt: new Date() })
      .where(eq(telegramUpdates.id, input.updateRowId));
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 120) : "TELEGRAM_PROCESSING_FAILED";
    await db().update(telegramUpdates).set({ status: "failed", errorCode, completedAt: new Date() })
      .where(eq(telegramUpdates.id, input.updateRowId));
    await sendTelegramMessage({
      token,
      chatId,
      text: `تعذر إكمال الطلب (${errorCode}). راجع حالة الوكيل والمزود أو أعد المحاولة برسالة جديدة.`,
    }).catch(() => undefined);
    console.error(JSON.stringify({
      level: "error",
      event: "telegram.update.failed",
      integrationId: input.integration.id,
      updateId: input.update.update_id,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }));
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ integrationId: string }> },
) {
  const requestId = getRequestId(request);
  const { integrationId } = await context.params;
  const [integration] = await db().select().from(integrations).where(and(
    eq(integrations.id, integrationId),
    eq(integrations.kind, "telegram"),
    eq(integrations.enabled, true),
    eq(integrations.status, "verified"),
  )).limit(1);
  if (!integration) return apiSuccess({ accepted: true }, requestId);
  const expectedHash = typeof integration.config.webhookSecretHash === "string"
    ? integration.config.webhookSecretHash
    : "";
  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!expectedHash || !suppliedSecret || !secureHashEquals(expectedHash, suppliedSecret)) {
    return new Response(null, { status: 401 });
  }
  const update = await request.json().catch(() => null) as TelegramUpdate | null;
  if (!update || !Number.isSafeInteger(update.update_id)) {
    return apiSuccess({ accepted: false }, requestId);
  }
  let updateRow;
  try {
    [updateRow] = await db().insert(telegramUpdates).values({
      integrationId: integration.id,
      updateId: String(update.update_id),
    }).returning({ id: telegramUpdates.id });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "23505") return apiSuccess({ accepted: true, duplicate: true }, requestId);
    throw error;
  }
  if (updateRow) after(() => processUpdate({ integration, update, updateRowId: updateRow.id }));
  return apiSuccess({ accepted: true }, requestId);
}
