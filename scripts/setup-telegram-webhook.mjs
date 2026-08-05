#!/usr/bin/env node

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const token = required("TELEGRAM_BOT_TOKEN");
const secret = required("TELEGRAM_WEBHOOK_SECRET");
const publicUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim()
  || `${(process.env.PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "")}/api/webhooks/telegram`;
if (!publicUrl.startsWith("https://")) throw new Error("Telegram webhook URL must use HTTPS.");
if (secret.length < 16) throw new Error("TELEGRAM_WEBHOOK_SECRET must contain at least 16 characters.");

async function call(method, body = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
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
      if (response.ok && payload?.ok) return payload.result;
      const description = typeof payload?.description === "string" ? payload.description.slice(0, 240) : "unknown error";
      lastError = new Error(`Telegram ${method} failed with status ${response.status}: ${description}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(`Telegram ${method} failed.`);
    } finally {
      clearTimeout(timer);
    }
    await delay(attempt * 1_000);
  }
  throw lastError ?? new Error(`Telegram ${method} failed.`);
}

const bot = await call("getMe");
if (!bot?.username) throw new Error("Telegram bot username is missing.");

// Always set the webhook on startup. getWebhookInfo does not expose the configured
// secret token, so comparing only the URL can leave a rotated secret out of sync.
await call("setWebhook", {
  url: publicUrl,
  secret_token: secret,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: false,
  max_connections: 40,
});

const verified = await call("getWebhookInfo");
if (verified?.url !== publicUrl) throw new Error("Telegram webhook verification failed: URL mismatch.");
if (verified?.last_error_message) {
  throw new Error(`Telegram webhook reports an error: ${String(verified.last_error_message).slice(0, 240)}`);
}
const allowedUpdates = Array.isArray(verified?.allowed_updates) ? verified.allowed_updates : [];
for (const update of ["message", "callback_query"]) {
  if (!allowedUpdates.includes(update)) throw new Error(`Telegram webhook is missing allowed update: ${update}.`);
}

console.log(JSON.stringify({
  level: "info",
  event: "telegram.webhook.configured",
  botUsername: bot.username,
  url: publicUrl,
  pendingUpdates: verified.pending_update_count ?? 0,
}));
