import { z, type ZodType } from "zod";
import { verifyGitHubToken } from "@/lib/integrations/github";
import { verifyTelegramToken } from "@/lib/integrations/telegram";

export type IntegrationCapability = "webhook" | "messages" | "files" | "repositories" | "read_file";

export interface IntegrationAdapter<TConfig> {
  id: "telegram" | "github";
  displayName: string;
  capabilities: readonly IntegrationCapability[];
  configSchema: ZodType<TConfig>;
  validateConfig(config: TConfig): Promise<Record<string, unknown>>;
  normalizeError(error: unknown): { code: string; retryable: boolean };
}

const tokenConfig = z.object({ token: z.string().trim().min(8).max(2000) }).strict();

const telegramAdapter: IntegrationAdapter<z.infer<typeof tokenConfig>> = {
  id: "telegram",
  displayName: "Telegram Bot",
  capabilities: ["webhook", "messages", "files"],
  configSchema: tokenConfig,
  async validateConfig(config) {
    const bot = await verifyTelegramToken(config.token);
    return { botId: bot.id, botUsername: bot.username, botName: bot.first_name };
  },
  normalizeError: () => ({ code: "TELEGRAM_API_ERROR", retryable: true }),
};

const githubAdapter: IntegrationAdapter<z.infer<typeof tokenConfig>> = {
  id: "github",
  displayName: "GitHub",
  capabilities: ["repositories", "read_file"],
  configSchema: tokenConfig,
  async validateConfig(config) {
    const identity = await verifyGitHubToken(config.token);
    return { login: identity.login, accountName: identity.name };
  },
  normalizeError: () => ({ code: "GITHUB_API_ERROR", retryable: true }),
};

const adapters = new Map<IntegrationAdapter<unknown>["id"], IntegrationAdapter<unknown>>([
  ["telegram", telegramAdapter as IntegrationAdapter<unknown>],
  ["github", githubAdapter as IntegrationAdapter<unknown>],
]);

export function integrationAdapter(id: "telegram" | "github") {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`Unknown integration adapter: ${id}`);
  return adapter;
}

export function listIntegrationAdapters() {
  return [...adapters.values()].map(({ id, displayName, capabilities }) => ({ id, displayName, capabilities }));
}
