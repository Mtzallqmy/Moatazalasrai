import { WhatsAppApiError } from "@/lib/integrations/whatsapp/client";
import { requireWhatsAppConfig, type WhatsAppRuntimeConfig } from "@/lib/integrations/whatsapp/config";

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 15_000;

function delay(attempt: number) {
  return 250 * 2 ** attempt + Math.floor(Math.random() * 100);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const messages = (value as Record<string, unknown>).messages;
  if (!Array.isArray(messages) || !messages.length) return null;
  const first = messages[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const id = (first as Record<string, unknown>).id;
  return typeof id === "string" && id ? id : null;
}

export async function sendWhatsAppTemplate(input: {
  to: string;
  templateName: string;
  languageCode?: string;
  parameters?: string[];
  config?: WhatsAppRuntimeConfig;
  fetchImpl?: typeof fetch;
}) {
  if (!/^\+?[1-9][0-9]{6,15}$/.test(input.to)) throw new Error("WHATSAPP_RECIPIENT_INVALID");
  if (!/^[a-z0-9_]{1,512}$/.test(input.templateName)) throw new Error("WHATSAPP_TEMPLATE_NAME_INVALID");
  const languageCode = input.languageCode ?? "ar";
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(languageCode)) throw new Error("WHATSAPP_TEMPLATE_LANGUAGE_INVALID");

  const config = input.config ?? requireWhatsAppConfig();
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `https://graph.facebook.com/${encodeURIComponent(config.graphApiVersion)}/${encodeURIComponent(config.phoneNumberId)}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to.replace(/^\+/, ""),
    type: "template",
    template: {
      name: input.templateName,
      language: { code: languageCode },
      ...(input.parameters?.length ? {
        components: [{
          type: "body",
          parameters: input.parameters.map((parameter) => ({ type: "text", text: parameter.slice(0, 1024) })),
        }],
      } : {}),
    },
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${config.accessToken}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (response.ok) {
        const id = messageId(payload);
        if (!id) throw new WhatsAppApiError(502, "WHATSAPP_API_INVALID_RESPONSE", "لم تؤكد Meta إرسال القالب.", false);
        return { messageId: id };
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS - 1) {
        throw new WhatsAppApiError(
          response.status === 429 ? 503 : 502,
          response.status === 429 ? "WHATSAPP_RATE_LIMITED" : "WHATSAPP_TEMPLATE_REJECTED",
          "رفضت Meta إرسال قالب WhatsApp.",
          retryable,
          { metaStatus: response.status },
        );
      }
    } catch (error) {
      if (error instanceof WhatsAppApiError) throw error;
      if (attempt === MAX_ATTEMPTS - 1) {
        const timedOut = error instanceof Error && error.name === "AbortError";
        throw new WhatsAppApiError(
          timedOut ? 504 : 503,
          timedOut ? "WHATSAPP_API_TIMEOUT" : "WHATSAPP_API_NETWORK_ERROR",
          timedOut ? "انتهت مهلة إرسال قالب WhatsApp." : "تعذر الاتصال بخدمة WhatsApp.",
          true,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
    await sleep(delay(attempt));
  }
  throw new Error("WHATSAPP_TEMPLATE_SEND_FAILED");
}
