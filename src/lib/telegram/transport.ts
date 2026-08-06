import {
  answerTelegramCallback,
  editTelegramMessage,
  sendTelegramChatAction,
  sendTelegramMessage,
  type TelegramInlineButton,
} from "@/lib/integrations/telegram";
import type { ChannelClientTransport, ChannelClientView } from "@/lib/channel-client/types";

function splitTelegramText(value: string) {
  const text = value.trim();
  if (!text) throw new Error("TELEGRAM_EMPTY_MESSAGE");
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 3900) {
    let boundary = remaining.lastIndexOf("\n", 3900);
    if (boundary < 1000) boundary = remaining.lastIndexOf(" ", 3900);
    if (boundary < 1000) boundary = 3900;
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function telegramRows(view: ChannelClientView, publicAppUrl: string): TelegramInlineButton[][] | undefined {
  return view.actions?.map((row) => row.map((action) => ({
    title: action.title,
    ...(action.url
      ? { url: action.url.startsWith("https://") ? action.url : `${publicAppUrl.replace(/\/$/, "")}${action.url.startsWith("/") ? action.url : `/${action.url}`}` }
      : { id: action.id }),
  })));
}

export function createTelegramChannelClientTransport(input: {
  token: string;
  chatId: string;
  callbackQueryId?: string | null;
  messageId?: string | null;
  publicAppUrl: string;
}): ChannelClientTransport {
  return {
    async answerCallback(text) {
      if (!input.callbackQueryId) return;
      await answerTelegramCallback({ token: input.token, callbackQueryId: input.callbackQueryId, text }).catch(() => undefined);
    },
    async sendTyping() {
      await sendTelegramChatAction({ token: input.token, chatId: input.chatId, action: "typing" }).catch(() => undefined);
    },
    async send(view) {
      const chunks = splitTelegramText(view.text);
      const rows = telegramRows(view, input.publicAppUrl);
      if (view.editCurrent && input.messageId && chunks.length === 1) {
        try {
          await editTelegramMessage({
            token: input.token,
            chatId: input.chatId,
            messageId: input.messageId,
            text: chunks[0],
            buttonRows: rows,
          });
          return;
        } catch {
          // Telegram may reject editing an old/deleted message. Send a new message instead.
        }
      }
      for (let index = 0; index < chunks.length; index += 1) {
        await sendTelegramMessage({
          token: input.token,
          chatId: input.chatId,
          text: chunks[index],
          buttonRows: index === chunks.length - 1 ? rows : undefined,
        });
      }
    },
  };
}
