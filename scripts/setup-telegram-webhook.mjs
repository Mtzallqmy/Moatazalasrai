#!/usr/bin/env node

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const token = required("TELEGRAM_BOT_TOKEN");
const secret = required("TELEGRAM_WEBHOOK_SECRET");
const baseUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim()
  || `${(process.env.PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "")}/api/webhooks/telegram`;
if (!baseUrl.startsWith("https://")) throw new Error("Telegram webhook URL must use HTTPS.");

async function call(method, body = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error(`Telegram ${method} failed with status ${response.status}.`);
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

const current = await call("getWebhookInfo");
const desiredUpdates = ["message", "callback_query"];
const alreadyConfigured = current?.url === baseUrl
  && Array.isArray(current?.allowed_updates)
  && desiredUpdates.every((item) => current.allowed_updates.includes(item));

if (!alreadyConfigured) {
  await call("setWebhook", {
    url: baseUrl,
    secret_token: secret,
    allowed_updates: desiredUpdates,
    drop_pending_updates: false,
  });
}

const verified = await call("getWebhookInfo");
if (verified?.url !== baseUrl) throw new Error("Telegram webhook verification failed.");
console.log(JSON.stringify({ event: "telegram.webhook.configured", url: baseUrl, pendingUpdates: verified.pending_update_count ?? 0 }));
