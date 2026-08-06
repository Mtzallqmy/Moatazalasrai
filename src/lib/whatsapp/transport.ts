import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendTextMessage,
} from "@/lib/integrations/whatsapp/client";
import type { ChannelClientAction, ChannelClientTransport, ChannelClientView } from "@/lib/channel-client/types";

function splitText(value: string) {
  const text = value.trim();
  if (!text) throw new Error("WHATSAPP_EMPTY_MESSAGE");
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

function flatten(actions: ChannelClientAction[][] | undefined) {
  return actions?.flat().filter((action) => action.title.trim()) ?? [];
}

export function createWhatsAppChannelClientTransport(input: {
  to: string;
  publicAppUrl: string;
}): ChannelClientTransport {
  return {
    async send(view: ChannelClientView) {
      const actions = flatten(view.actions);
      const links = actions.filter((action) => action.url).map((action) => {
        const url = action.url?.startsWith("https://")
          ? action.url
          : `${input.publicAppUrl.replace(/\/$/, "")}${action.url?.startsWith("/") ? action.url : `/${action.url}`}`;
        return `${action.title}: ${url}`;
      });
      const chunks = splitText([view.text, ...links].filter(Boolean).join("\n\n"));
      const callbacks = actions.filter((action) => !action.url && action.id);
      for (let index = 0; index < chunks.length - 1; index += 1) {
        await sendTextMessage({ to: input.to, text: chunks[index] });
      }
      const last = chunks.at(-1) ?? "تعذر عرض المحتوى.";
      if (callbacks.length >= 1 && callbacks.length <= 3 && callbacks.every((action) => action.title.length <= 20)) {
        await sendInteractiveButtons({
          to: input.to,
          bodyText: last,
          footerText: "منصة معتز",
          buttons: callbacks.map((action) => ({ id: action.id.slice(0, 128), title: action.title.slice(0, 20) })),
        });
        return;
      }
      if (callbacks.length > 0) {
        await sendInteractiveList({
          to: input.to,
          bodyText: last,
          buttonText: "عرض الخيارات",
          title: "الإجراءات المتاحة",
          actions: callbacks.slice(0, 10).map((action) => ({
            id: action.id.slice(0, 200),
            title: action.title.slice(0, 24),
          })),
        });
        return;
      }
      await sendTextMessage({ to: input.to, text: last, previewUrl: links.length > 0 });
    },
  };
}
