// WhatsApp Cloud API client with bounded retries, media support, and safe Meta diagnostics.
import { ApiError } from "@/lib/http/api";
import { requireWhatsAppConfig, type WhatsAppRuntimeConfig } from "./config";

const RETRYABLE_STATUSES = new Set([408, 429]);
const MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const ACTION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

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

function requiredText(value: string, input: { code: string; message: string; maximum: number }) {
  const text = value.trim();
  if (!text) throw new WhatsAppApiError(400, input.code, input.message, false);
  return text.length > input.maximum ? `${text.slice(0, Math.max(1, input.maximum - 1))}…` : text;
}

function graphUrl(config: WhatsAppRuntimeConfig, resource: string) {
  return `https://graph.facebook.com/${encodeURIComponent(config.graphApiVersion)}/${encodeURIComponent(resource)}`;
}

function graphMessagesUrl(config: WhatsAppRuntimeConfig) {
  return `${graphUrl(config, config.phoneNumberId)}/messages`;
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

function metaFailure(responseStatus: number, metaError: MetaErrorEnvelope["error"]) {
  const metaCode = metaError?.code;
  const metaSubcode = metaError?.error_subcode;
  const details = {
    metaStatus: responseStatus,
    metaCode,
    metaSubcode,
    metaType: metaError?.type,
    traceId: metaError?.fbtrace_id,
  };
  if (metaCode === 190 || responseStatus === 401) {
    return new WhatsAppApiError(502, "WHATSAPP_INVALID_TOKEN", "Access Token الخاص بـMeta غير صالح أو منتهي.", false, details);
  }
  if (metaCode === 10 || metaCode === 200 || responseStatus === 403) {
    return new WhatsAppApiError(502, "WHATSAPP_PERMISSION_MISSING", "يفتقد توكن Meta صلاحية WhatsApp المطلوبة.", false, details);
  }
  if (metaCode === 100) {
    return new WhatsAppApiError(502, "WHATSAPP_PHONE_NUMBER_ID_INVALID", "Phone Number ID أو أحد معاملات Meta غير صحيح.", false, details);
  }
  if (metaCode === 131030) {
    return new WhatsAppApiError(422, "WHATSAPP_RECIPIENT_NOT_ALLOWED", "رقم المستلم غير مسموح له باستقبال رسالة الاختبار في إعداد Meta الحالي.", false, details);
  }
  if (metaCode === 131047) {
    return new WhatsAppApiError(422, "WHATSAPP_TEMPLATE_REQUIRED", "انتهت نافذة المحادثة ويتطلب الإرسال قالبًا معتمدًا من Meta.", false, details);
  }
  if (metaCode === 131026) {
    return new WhatsAppApiError(502, "WHATSAPP_MESSAGE_UNDELIVERABLE", "تعذر تسليم رسالة WhatsApp إلى الرقم المحدد.", false, details);
  }
  if (metaCode === 133010) {
    return new WhatsAppApiError(502, "WHATSAPP_PHONE_NOT_REGISTERED", "رقم WhatsApp Business غير مسجل أو غير جاهز في Cloud API.", false, details);
  }
  if (responseStatus === 429) {
    return new WhatsAppApiError(503, "WHATSAPP_RATE_LIMITED", "بلغ WhatsApp حد الطلبات مؤقتًا.", true, details);
  }
  if (responseStatus >= 500) {
    return new WhatsAppApiError(503, "WHATSAPP_API_UNAVAILABLE", "خدمة WhatsApp غير متاحة مؤقتًا.", true, details);
  }
  return new WhatsAppApiError(
    502,
    "WHATSAPP_API_REJECTED",
    metaError?.message ? `رفضت Meta الطلب: ${metaError.message.slice(0, 240)}` : "رفضت Meta طلب WhatsApp.",
    retryableStatus(responseStatus),
    details,
  );
}

async function fetchJson<T>(input: {
  url: string;
  accessToken: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
}): Promise<T> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(input.url, {
        method: input.method ?? "GET",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${input.accessToken}`,
          ...(input.body ? { "content-type": "application/json" } : {}),
          "user-agent": "MoatazAgentPlatform/1.0",
        },
        ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      });
      const body = await response.json().catch(() => null) as MetaErrorEnvelope | T | null;
      if (response.ok && body !== null) return body as T;
      const metaError = body && typeof body === "object" && "error" in body
        ? (body as MetaErrorEnvelope).error
        : undefined;
      const failure = metaFailure(response.status, metaError);
      if (!failure.retryable || attempt === MAX_ATTEMPTS - 1) throw failure;
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

async function graphRequest(
  payload: Record<string, unknown>,
  options: {
    config?: WhatsAppRuntimeConfig;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  } = {},
) {
  const config = options.config ?? requireWhatsAppConfig();
  return fetchJson<Record<string, unknown>>({
    url: graphMessagesUrl(config),
    accessToken: config.accessToken,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    method: "POST",
    body: payload,
  });
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
  replyToMessageId?: string;
  config?: WhatsAppRuntimeConfig;
  fetchImpl?: FetchLike;
}) {
  const text = requiredText(input.text, {
    code: "WHATSAPP_EMPTY_TEXT",
    message: "لا يمكن إرسال رسالة WhatsApp فارغة.",
    maximum: 4096,
  });
  const response = await graphRequest({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "text",
    ...(input.replyToMessageId ? { context: { message_id: input.replyToMessageId } } : {}),
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
    throw new WhatsAppApiError(400, "WHATSAPP_BUTTON_COUNT_INVALID", "يجب أن تحتوي رسالة الأزرار على زر واحد إلى ثلاثة أزرار.", false);
  }
  const bodyText = requiredText(input.bodyText, {
    code: "WHATSAPP_EMPTY_TEXT",
    message: "لا يمكن إرسال قائمة أزرار بلا محتوى.",
    maximum: 1024,
  });
  const buttons = input.buttons.map((button) => {
    const id = button.id.trim();
    const title = button.title.trim();
    if (!ACTION_ID_PATTERN.test(id)) throw new WhatsAppApiError(400, "WHATSAPP_ACTION_ID_INVALID", "معرّف زر WhatsApp غير صالح.", false);
    if (!title || title.length > 20) throw new WhatsAppApiError(400, "WHATSAPP_ACTION_TITLE_INVALID", "عنوان زر WhatsApp غير صالح.", false);
    return { id, title };
  });
  const footerText = input.footerText?.trim();
  const response = await graphRequest({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      ...(footerText ? { footer: { text: footerText.slice(0, 60) } } : {}),
      action: {
        buttons: buttons.map((button) => ({
          type: "reply",
          reply: { id: button.id, title: button.title },
        })),
      },
    },
  }, input);
  return assertAcceptedMessage(response);
}

export async function sendInteractiveList(input: {
  to: string;
  bodyText: string;
  buttonText: string;
  title: string;
  actions: Array<{ id: string; title: string; description?: string }>;
  config?: WhatsAppRuntimeConfig;
  fetchImpl?: FetchLike;
}) {
  if (input.actions.length < 1 || input.actions.length > 10) {
    throw new WhatsAppApiError(400, "WHATSAPP_LIST_COUNT_INVALID", "يجب أن تحتوي قائمة WhatsApp على عنصر واحد إلى عشرة عناصر.", false);
  }
  const bodyText = requiredText(input.bodyText, {
    code: "WHATSAPP_EMPTY_TEXT",
    message: "لا يمكن إرسال قائمة WhatsApp بلا محتوى.",
    maximum: 1024,
  });
  const buttonText = requiredText(input.buttonText, {
    code: "WHATSAPP_LIST_BUTTON_EMPTY",
    message: "عنوان فتح قائمة WhatsApp مطلوب.",
    maximum: 20,
  });
  const title = requiredText(input.title, {
    code: "WHATSAPP_LIST_TITLE_EMPTY",
    message: "عنوان قسم WhatsApp مطلوب.",
    maximum: 24,
  });
  const actions = input.actions.map((action) => {
    const id = action.id.trim();
    const actionTitle = action.title.trim();
    if (!ACTION_ID_PATTERN.test(id)) throw new WhatsAppApiError(400, "WHATSAPP_ACTION_ID_INVALID", "معرّف عنصر WhatsApp غير صالح.", false);
    if (!actionTitle) throw new WhatsAppApiError(400, "WHATSAPP_ACTION_TITLE_INVALID", "عنوان عنصر WhatsApp مطلوب.", false);
    return {
      id,
      title: actionTitle.slice(0, 24),
      ...(action.description?.trim() ? { description: action.description.trim().slice(0, 72) } : {}),
    };
  });
  const response = await graphRequest({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: {
        button: buttonText,
        sections: [{ title, rows: actions }],
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
  const messageId = requiredText(input.messageId, {
    code: "WHATSAPP_MESSAGE_ID_EMPTY",
    message: "معرّف رسالة WhatsApp مطلوب.",
    maximum: 512,
  });
  const response = await graphRequest({
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
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

export async function testWhatsAppPhoneNumber(input: {
  config?: WhatsAppRuntimeConfig;
  fetchImpl?: FetchLike;
}) {
  const config = input.config ?? requireWhatsAppConfig();
  const url = new URL(graphUrl(config, config.phoneNumberId));
  url.searchParams.set("fields", "id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type");
  return fetchJson<{
    id: string;
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
    code_verification_status?: string;
    platform_type?: string;
  }>({
    url: url.toString(),
    accessToken: config.accessToken,
    fetchImpl: input.fetchImpl,
  });
}

export async function downloadWhatsAppMedia(input: {
  mediaId: string;
  filename?: string;
  config?: WhatsAppRuntimeConfig;
  fetchImpl?: FetchLike;
}) {
  const config = input.config ?? requireWhatsAppConfig();
  const mediaId = requiredText(input.mediaId, {
    code: "WHATSAPP_MEDIA_ID_EMPTY",
    message: "معرّف وسائط WhatsApp مطلوب.",
    maximum: 512,
  });
  const metadata = await fetchJson<{ url?: string; mime_type?: string; file_size?: number }>({
    url: graphUrl(config, mediaId),
    accessToken: config.accessToken,
    fetchImpl: input.fetchImpl,
  });
  if (!metadata.url) {
    throw new WhatsAppApiError(502, "WHATSAPP_MEDIA_URL_MISSING", "لم تُرجع Meta رابط تنزيل الوسائط.", false);
  }
  const mediaUrl = new URL(metadata.url);
  if (mediaUrl.protocol !== "https:" || mediaUrl.username || mediaUrl.password) {
    throw new WhatsAppApiError(502, "WHATSAPP_MEDIA_URL_INVALID", "رابط وسائط Meta غير آمن.", false);
  }
  if (metadata.file_size && metadata.file_size > MAX_MEDIA_BYTES) {
    throw new WhatsAppApiError(413, "WHATSAPP_MEDIA_TOO_LARGE", "حجم ملف WhatsApp يتجاوز 20 ميجابايت.", false);
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(mediaUrl, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
      headers: { authorization: `Bearer ${config.accessToken}`, accept: "application/octet-stream" },
    });
    if (!response.ok) throw metaFailure(response.status, undefined);
    const content = Buffer.from(await response.arrayBuffer());
    if (content.byteLength > MAX_MEDIA_BYTES) {
      throw new WhatsAppApiError(413, "WHATSAPP_MEDIA_TOO_LARGE", "حجم ملف WhatsApp يتجاوز 20 ميجابايت.", false);
    }
    const mimeType = metadata.mime_type || response.headers.get("content-type") || "application/octet-stream";
    return {
      content,
      mimeType,
      filename: input.filename?.trim() || `whatsapp-${mediaId}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}