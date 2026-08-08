import { ApiError } from "@/lib/http/api";
import {
  configureAndVerifyTelegramWebhook,
  getTelegramWebhookInfo,
  registerCentralTelegramCommands,
  verifyTelegramToken,
} from "@/lib/integrations/telegram";
import { telegramPlatformConfig } from "@/lib/integrations/telegram-platform";

const requiredUpdates = ["message", "edited_message", "callback_query"] as const;

function webhookHealthy(url: string, allowedUpdates: string[] | undefined) {
  if (!url) return false;
  const allowed = new Set(allowedUpdates ?? []);
  return requiredUpdates.every((update) => allowed.has(update));
}

export async function reconcileCentralTelegramWebhook(options: { force?: boolean } = {}) {
  const config = telegramPlatformConfig();
  if (!config.enabled) return { enabled: false as const, configured: false as const };
  if (config.updateMode !== "webhook") return { enabled: true as const, configured: false as const, mode: config.updateMode };
  if (!config.botToken || !config.webhookUrl || !config.webhookSecret) {
    throw new ApiError(503, "TELEGRAM_WEBHOOK_CONFIG_INCOMPLETE", "إعدادات Telegram المركزي غير مكتملة.");
  }
  if (!config.webhookUrl.startsWith("https://")) {
    throw new ApiError(503, "TELEGRAM_HTTPS_REQUIRED", "Telegram Webhook المركزي يتطلب HTTPS.");
  }

  const [bot, current] = await Promise.all([
    verifyTelegramToken(config.botToken),
    getTelegramWebhookInfo(config.botToken),
  ]);
  const needsRepair = options.force === true
    || current.url !== config.webhookUrl
    || !webhookHealthy(current.url, current.allowed_updates)
    || Boolean(current.last_error_message);
  const info = needsRepair
    ? await configureAndVerifyTelegramWebhook({
        token: config.botToken,
        url: config.webhookUrl,
        secretToken: config.webhookSecret,
        mode: "central",
      })
    : current;
  if (!needsRepair) await registerCentralTelegramCommands(config.botToken);

  return {
    enabled: true as const,
    configured: true as const,
    repaired: needsRepair,
    botId: String(bot.id),
    botUsername: bot.username ?? null,
    webhookUrl: info.url,
    pendingUpdateCount: info.pending_update_count ?? 0,
    lastErrorMessage: info.last_error_message?.slice(0, 240) ?? null,
  };
}
