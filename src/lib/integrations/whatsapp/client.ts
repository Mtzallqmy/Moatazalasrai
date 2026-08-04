import { ApiError } from "@/lib/http/api";
import { requireWhatsAppConfig, type WhatsAppRuntimeConfig } from "./config";

const RETRYABLE_STATUSES = new Set([408, 429]);
const MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;

type FetchLike = typeof fetch;

type MetaErrorEnvelope = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

export class WhatsAppApiError extends ApiError {
  constructor(
    status: number,
    code: string,
    message: string,
    public readonly retryable: boolean,
    details?: Record<string, unknown>,
  ) {
    super(status, code, message, details);
    this.name = "WhatsAppApiError";
  }
}

function graphMessagesUrl(config: WhatsAppRuntimeConfig) {
  return `https://graph.facebook.com/${encodeURIComponent(config.graphApiVersion)}/${encodeURIComponent(config.phoneNumberId)}/messages`;
}

function retryableStatus(status: number) {
  return RETRYABLE_STATUSES.has(status) || status >= 500;
}

function retryDelay(attempt: number) {
  const base = Math.min(2_000, 250 * 2 ** attempt);
  return base + Math.floor(Math.random() * 150);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphRequest(
  payload: Record<string, unknown>,
  options: {
    config?: WhatsAppRuntimeConfig;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  } = {},
) {
  const config = options.config ?? requireWhatsAppConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(graphMessagesUrl(config), {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
          "content-type": "application/json",
          "user-agent": "MoatazAgentPlatform/1.0",
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null) as MetaErrorEnvelope | Record<string, unknown> | null;
      if (response.ok) return body ?? {};

      const metaError = body && "error" in body ? (body as MetaErrorEnvelope).error : undefined;
      const retryable = retryableStatus(response.status);
      const details = {
        metaStatus: response.status,
        metaCode: metaError?.code,
        metaSubcode: metaError?.error_subcode,
        metaType: metaError?.type,
        traceId: metaError?.fbtrace_id,
      };
      if (!retryable || attempt === MAX_ATTEMPTS - 1) {
        throw new WhatsAppApiError(
          response.status === 401 || response.status === 403 ? 502 : response.status >= 500 ? 503 : 502,
          response.status === 401 || response.status === 403
            ? "WHATSAPP_AUTH_REJECTED"
            : response.status === 429
              ? "WHATSAPP_RATE_LIMITED"
              : response.status >= 500
                ? "WHATSAPP_API_UNAVAILABLE"
                : "WHATSAPP_API_REJECTED",
          response.status === 401 || response.status === 403
            ? "رفضت Meta بيانات اعتماد WhatsApp."
            : response.status === 429
              ? "بلغ WhatsApp حد الطلبات مؤقتًا."
              : response.status >= 500
                ? "خدمة WhatsApp غير متاحة مؤقتًا."
                : "رفضت Meta طلب WhatsApp.",
          retryable,
          details,
        );
      }
      await sleep(retryDelay(attempt));
    } catch (error) {
      if (error instanceof WhatsAppApiError) throw error;
      lastError = error;
      const timedOut = error instanceof Error && error.name === "AbortError";
      if (attempt === MAX_ATTEMPTS - 1) {
        throw new WhatsAppApiError(
          timedOut ? 504 : 503,
          timedOut ? "WHATSAPP_API_TIMEOUT" : "WHATSAPP_API_NETWORK_ERROR",
          timedOut ? "انتهت مهلة الاتصال بخدمة WhatsApp." : "تعذر الاتصال بخدمة WhatsApp.",
          true,
        );
      }
      await sleep(retryDelay(attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function acceptedMessageId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const messages = (value as Record<string, unknown>).messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const first = messages[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const id = (first as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() ? id : null;
}

function assertAcceptedMessage(value: unknown) {
  const messageId = acceptedMessageId(value);
  if (!messageId) {
    throw new WhatsAppApiError(
      502,
      "WHATSAPP_API_INVALID_RESPONSE",
      "أعادت Meta استجابة غير مكتملة، لذلك لا يمكن تأكيد إرسال رسالة WhatsApp.",
      false,
    );
  }
  return { messageId };
}

export async function sendTextMessage(input: {
  to: string;
  text: string;
  previewUrl?: boolean;
  config?: WhatsAppRuntimeConfig;
  fetchImpl?: FetchLike;
}) {
  const text = input.text.length > 4096 ? `${input.text.slice(0, 4090)}…` : input.text;
  const response = await graphRequest({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "text",
    text: { preview_url: input.previewUrl ?? false, body: text },
  }, input);
  return assertAcceptedMessage(response);
}

export async function sendInteractiveButtons(input: {
  to: string;
  bodyText: string;
  footerText?: string;
  buttons: Array<{ id: string; title: string }>;
  config?: WhatsAppRuntimeConfig;
  fetchImpl?: FetchLike;
}) {
  if (input.buttons.length < 1 || input.buttons.length > 3) {
    throw new Error("WhatsApp interactive buttons must contain between one and three buttons.");
  }
  for (const button of input.buttons) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(button.id)) throw new Error("WhatsApp button ID is invalid.");
    if (!button.title.trim() || button.title.length > 20) throw new Error("WhatsApp button title is invalid.");
  }
  const response = await graphRequest({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: input.bodyText.slice(0, 1024) },
      ...(input.footerText ? { footer: { text: input.footerText.slice(0, 60) } } : {}),
      action: {
        buttons: input.buttons.map((button) => ({
          type: "reply",
          reply: { id: button.id, title: button.title },
        })),
      },
    },
  }, input);
  return assertAcceptedMessage(response);
}

export async function markMessageAsRead(input: {
  messageId: string;
  config?: WhatsAppRuntimeConfig;
  fetchImpl?: FetchLike;
}) {
  const response = await graphRequest({
    messaging_product: "whatsapp",
    status: "read",
    message_id: input.messageId,
  }, input);
  if (!response || typeof response !== "object" || Array.isArray(response)
    || (response as Record<string, unknown>).success !== true) {
    throw new WhatsAppApiError(
      502,
      "WHATSAPP_API_INVALID_RESPONSE",
      "أعادت Meta استجابة غير مكتملة، لذلك لا يمكن تأكيد تحديث حالة رسالة WhatsApp.",
      false,
    );
  }
  return { success: true as const };
}
