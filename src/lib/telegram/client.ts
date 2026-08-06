import {
  answerTelegramCallback as answerCallbackApi,
  downloadTelegramFile,
  editTelegramMessage,
  editTelegramReplyMarkup,
  sendTelegramChatAction,
  sendTelegramDocumentApi,
  sendTelegramMessage,
  type TelegramInlineButton,
} from "@/lib/integrations/telegram";
import { centralTelegramBot } from "@/lib/integrations/telegram-platform";

export type TelegramButton = TelegramInlineButton;

async function token() {
  return (await centralTelegramBot()).token;
}

export async function telegramSend(input: {
  chatId: string;
  text: string;
  messageId?: string;
  buttonRows?: TelegramButton[][];
}) {
  const botToken = await token();
  return input.messageId
    ? editTelegramMessage({ token: botToken, chatId: input.chatId, messageId: input.messageId, text: input.text, buttonRows: input.buttonRows })
    : sendTelegramMessage({ token: botToken, chatId: input.chatId, text: input.text, buttonRows: input.buttonRows });
}

export async function telegramEditMarkup(input: {
  chatId: string;
  messageId: string;
  buttonRows?: TelegramButton[][];
}) {
  return editTelegramReplyMarkup({ token: await token(), ...input });
}

export async function telegramAnswerCallback(input: { callbackId: string; text?: string }) {
  return answerCallbackApi({ token: await token(), callbackQueryId: input.callbackId, text: input.text });
}

export async function telegramChatAction(input: {
  chatId: string;
  action: "typing" | "upload_document" | "upload_photo" | "record_voice" | "upload_video";
}) {
  return sendTelegramChatAction({ token: await token(), ...input });
}

export async function telegramDownload(fileId: string) {
  return downloadTelegramFile(await token(), fileId);
}

export async function telegramSendDocument(input: {
  chatId: string;
  filename: string;
  mimeType: string;
  content: Buffer;
  caption?: string;
}) {
  return sendTelegramDocumentApi({ token: await token(), ...input });
}
