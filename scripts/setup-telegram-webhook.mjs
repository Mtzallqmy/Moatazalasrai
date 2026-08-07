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
const configuredUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim();
const appUrl = (process.env.PUBLIC_APP_URL || process.env.APP_URL || "").trim().replace(/\/$/, "");
const publicUrl = configuredUrl || `${appUrl}/api/webhooks/telegram`;
if (!publicUrl.startsWith("https://")) throw new Error("Telegram webhook URL must use HTTPS.");
if (secret.length < 16) throw new Error("TELEGRAM_WEBHOOK_SECRET must contain at least 16 characters.");

const commands = [
  { command: "start", description: "بدء البوت وعرض القائمة" },
  { command: "help", description: "عرض المساعدة" },
  { command: "status", description: "حالة الحساب والجلسة" },
  { command: "agents", description: "عرض الوكلاء المتاحين" },
  { command: "new", description: "بدء محادثة حقيقية" },
  { command: "approvals", description: "عرض الموافقات المعلقة" },
  { command: "cancel", description: "إلغاء العملية الحالية" },
  { command: "unlink", description: "فصل حساب Telegram" },
];
const allowedUpdates = ["message", "edited_message", "callback_query"];

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

await call("setWebhook", {
  url: publicUrl,
  secret_token: secret,
  allowed_updates: allowedUpdates,
  drop_pending_updates: false,
  max_connections: 40,
});

await call("setMyCommands", {
  commands,
  scope: { type: "all_private_chats" },
  language_code: "ar",
});

const verified = await call("getWebhookInfo");
if (verified?.url !== publicUrl) throw new Error("Telegram webhook verification failed: URL mismatch.");
const registeredUpdates = Array.isArray(verified?.allowed_updates) ? verified.allowed_updates : [];
for (const update of allowedUpdates) {
  if (!registeredUpdates.includes(update)) throw new Error(`Telegram webhook is missing allowed update: ${update}.`);
}
if (verified?.last_error_message) {
  console.warn(JSON.stringify({
    level: "warn",
    event: "telegram.webhook.previous_delivery_error",
    message: String(verified.last_error_message).slice(0, 240),
    lastErrorAt: verified.last_error_date ?? null,
  }));
}

console.log(JSON.stringify({
  level: "info",
  event: "telegram.webhook.configured",
  botUsername: bot.username,
  url: publicUrl,
  pendingUpdates: verified.pending_update_count ?? 0,
  lastErrorMessage: verified.last_error_message ? String(verified.last_error_message).slice(0, 240) : null,
  allowedUpdates: registeredUpdates,
  commandCount: commands.length,
}));
