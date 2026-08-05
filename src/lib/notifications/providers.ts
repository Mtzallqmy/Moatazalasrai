export class NotificationProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    message = code,
  ) {
    super(message);
    this.name = "NotificationProviderError";
  }
}

const TIMEOUT_MS = 15_000;

async function providerFetch(input: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  fetchImpl?: typeof fetch;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await (input.fetchImpl ?? fetch)(input.url, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: { accept: "application/json", "content-type": "application/json", ...input.headers },
      body: JSON.stringify(input.body),
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new NotificationProviderError(`PROVIDER_HTTP_${response.status}`, retryable);
    }
    return payload;
  } catch (error) {
    if (error instanceof NotificationProviderError) throw error;
    const timedOut = error instanceof Error && error.name === "AbortError";
    throw new NotificationProviderError(
      timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_NETWORK_ERROR",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function sendEmailNotification(input: {
  to: string;
  subject: string;
  body: string;
  fetchImpl?: typeof fetch;
  apiKey?: string;
  from?: string;
}) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to) || input.to.length > 320) {
    throw new NotificationProviderError("EMAIL_RECIPIENT_INVALID", false);
  }
  const apiKey = input.apiKey ?? process.env.RESEND_API_KEY?.trim();
  const from = input.from ?? process.env.NOTIFICATION_EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new NotificationProviderError("EMAIL_PROVIDER_NOT_CONFIGURED", false);
  const payload = object(await providerFetch({
    url: "https://api.resend.com/emails",
    headers: { authorization: `Bearer ${apiKey}` },
    body: { from, to: [input.to], subject: input.subject.slice(0, 500), text: input.body.slice(0, 100_000) },
    fetchImpl: input.fetchImpl,
  }));
  const id = typeof payload.id === "string" ? payload.id : null;
  if (!id) throw new NotificationProviderError("EMAIL_PROVIDER_INVALID_RESPONSE", true);
  return { messageId: id };
}

export async function sendPushNotification(input: {
  token: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}) {
  if (!/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,}\]$/.test(input.token)) {
    throw new NotificationProviderError("PUSH_TOKEN_INVALID", false);
  }
  const payload = object(await providerFetch({
    url: "https://exp.host/--/api/v2/push/send",
    headers: {},
    body: {
      to: input.token,
      title: input.title.slice(0, 200),
      body: input.body.slice(0, 4_000),
      data: input.data ?? {},
      sound: "default",
      priority: "high",
    },
    fetchImpl: input.fetchImpl,
  }));
  const data = object(payload.data);
  if (data.status === "error") {
    const details = object(data.details);
    const permanent = details.error === "DeviceNotRegistered" || details.error === "MessageTooBig";
    throw new NotificationProviderError(`PUSH_${String(details.error ?? "REJECTED")}`, !permanent);
  }
  const id = typeof data.id === "string" ? data.id : null;
  if (!id) throw new NotificationProviderError("PUSH_PROVIDER_INVALID_RESPONSE", true);
  return { messageId: id };
}
