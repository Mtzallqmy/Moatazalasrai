import { ApiError } from "@/lib/http/api";
import { telegramPlatformConfig } from "@/lib/integrations/telegram-platform";
import type { TelegramInlineButton } from "@/lib/integrations/telegram";
import {
  findOrganizationGitHubRepository,
  listOrganizationGitHubRepositories,
} from "@/lib/repositories/github-application-service";
import { assertTelegramCapability } from "./capability-registry";
import { sendTelegramEmptyState, sendTelegramList, sendTelegramMenu } from "./message-renderer";

type RepositoryContext = {
  token: string;
  chatId: string;
  userId: string;
  organizationId: string;
};

function dashboardUrl(path: string) {
  const base = telegramPlatformConfig().publicAppUrl?.trim().replace(/\/$/, "");
  return base ? `${base}${path}` : null;
}

function dashboardButton(path: string, title: string): TelegramInlineButton[] {
  const url = dashboardUrl(path);
  return url ? [{ url, title }] : [];
}

async function assertRepositories(input: RepositoryContext) {
  const capability = await assertTelegramCapability({
    userId: input.userId,
    organizationId: input.organizationId,
    capabilityId: "repositories.list",
  });
  if (!capability) throw new ApiError(403, "TELEGRAM_REPOSITORIES_DENIED", "GitHub والمستودعات غير متاحة لحسابك.");
}

export async function listTelegramRepositories(input: RepositoryContext) {
  await assertRepositories(input);
  try {
    const result = await listOrganizationGitHubRepositories({
      organizationId: input.organizationId,
      userId: input.userId,
      limit: 20,
    });
    if (!result.repositories.length) {
      await sendTelegramEmptyState({
        token: input.token,
        chatId: input.chatId,
        reason: "تكامل GitHub متحقق لكنه لم يُرجع مستودعات متاحة للقراءة.",
        action: "راجع صلاحيات تكامل GitHub من لوحة الموقع.",
        buttonRows: [
          ...dashboardButton("/dashboard/integrations", "فتح التكاملات").map((button) => [button]),
          [{ id: "nav:home", title: "الرئيسية" }],
        ],
      });
      return;
    }
    await sendTelegramList({
      token: input.token,
      chatId: input.chatId,
      title: [
        "الرئيسية ← القنوات والتكاملات ← GitHub",
        `الاتصال: ${result.integration.name}`,
        `الحساب: ${result.integration.login ? `@${result.integration.login}` : "غير متاح"}`,
        `آخر تحقق: ${result.integration.lastVerifiedAt ? new Date(result.integration.lastVerifiedAt).toLocaleString("ar-SA") : "غير متاح"}`,
      ].join("\n"),
      items: result.repositories.map((repo, index) => [
        `${index + 1}. ${repo.fullName}`,
        `الخصوصية: ${repo.private ? "خاص" : "عام"}`,
        `الفرع الافتراضي: ${repo.defaultBranch}`,
        `اللغة: ${repo.language ?? "غير محددة"}`,
        `آخر تحديث: ${new Date(repo.updatedAt).toLocaleString("ar-SA")}`,
      ].join("\n")),
      emptyText: "لا توجد مستودعات GitHub متاحة.",
      buttonRows: [
        ...result.repositories.slice(0, 10).map((repo) => [{ id: `repository:view:${repo.id}`, title: repo.name.slice(0, 55) }]),
        [{ id: "repositories:list", title: "تحديث" }, { id: "nav:home", title: "الرئيسية" }],
      ],
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "GITHUB_NOT_CONFIGURED") {
      await sendTelegramEmptyState({
        token: input.token,
        chatId: input.chatId,
        reason: "لا يوجد تكامل GitHub مفعّل ومتحقق لهذه المؤسسة.",
        action: "اربط GitHub من لوحة الموقع. لا ترسل أي Token داخل Telegram.",
        buttonRows: [
          ...dashboardButton("/dashboard/integrations", "فتح التكاملات").map((button) => [button]),
          [{ id: "nav:home", title: "الرئيسية" }],
        ],
      });
      return;
    }
    throw error;
  }
}

export async function showTelegramRepository(input: RepositoryContext & { repositoryId: number }) {
  await assertRepositories(input);
  const result = await findOrganizationGitHubRepository({
    organizationId: input.organizationId,
    userId: input.userId,
    repositoryId: input.repositoryId,
  });
  const repo = result.repository;
  await sendTelegramMenu({
    token: input.token,
    chatId: input.chatId,
    title: [
      `الرئيسية ← GitHub ← ${repo.name}`,
      repo.fullName,
      repo.description || "بدون وصف",
      `الخصوصية: ${repo.private ? "خاص" : "عام"}`,
      `الفرع الافتراضي: ${repo.defaultBranch}`,
      `اللغة: ${repo.language ?? "غير محددة"}`,
      `الحجم: ${repo.sizeKb === null ? "غير متاح" : `${repo.sizeKb} KB`}`,
      `آخر تحديث: ${new Date(repo.updatedAt).toLocaleString("ar-SA")}`,
    ].join("\n"),
    buttonRows: [[
      { id: "repositories:list", title: "رجوع" },
      ...dashboardButton("/dashboard/repositories", "فتح في الموقع"),
    ]],
  });
}
