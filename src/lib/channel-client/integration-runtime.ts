import { ApiError } from "@/lib/http/api";
import {
  findOrganizationGitHubRepository,
  listOrganizationGitHubRepositories,
} from "@/lib/repositories/github-application-service";
import { resolveChannelCapabilities } from "./capability-registry";
import { channelEmptyState, sendChannelClientView } from "./message-renderer";
import type { ChannelClientRuntimeInput, ChannelClientRuntimeResult } from "./types";

function commandAction(input: ChannelClientRuntimeInput) {
  if (input.actionId) return input.actionId;
  const value = input.text.trim().toLocaleLowerCase("en-US").replace(/@\w+$/, "");
  if (["/github", "/repos", "/repositories", "github", "جيت هب", "المستودعات", "مستودعات"].includes(value)) return "cc.repos";
  return null;
}

async function hasRepositoriesCapability(input: ChannelClientRuntimeInput) {
  const capabilities = await resolveChannelCapabilities({
    identity: input.identity,
    featureAllowed: input.featureAllowed,
  });
  return capabilities.some((capability) => capability.id === "repositories.list");
}

export async function processChannelIntegrations(input: ChannelClientRuntimeInput): Promise<ChannelClientRuntimeResult | null> {
  const action = commandAction(input);
  if (action !== "cc.repos" && !/^cc\.repo:\d+$/.test(action ?? "")) return null;
  if (!await hasRepositoriesCapability(input)) {
    throw new ApiError(403, "CHANNEL_REPOSITORIES_DENIED", "GitHub والمستودعات غير متاحة لحسابك أو غير مفعلة في سياسة القناة.");
  }

  if (action === "cc.repos") {
    try {
      const result = await listOrganizationGitHubRepositories({
        organizationId: input.identity.organizationId,
        userId: input.identity.userId,
        limit: 20,
      });
      if (!result.repositories.length) {
        await sendChannelClientView(input.transport, channelEmptyState({
          title: "GitHub متصل لكن لا توجد مستودعات متاحة",
          reason: "الاتصال متحقق، لكن GitHub لم يُرجع مستودعات يستطيع هذا التكامل قراءتها.",
          action: { id: "cc.home", title: "الرئيسية" },
          path: ["الرئيسية", "GitHub والمستودعات"],
        }));
        return { handled: true, session: input.session };
      }
      await sendChannelClientView(input.transport, {
        path: ["الرئيسية", "GitHub والمستودعات"],
        text: [
          `الاتصال: ${result.integration.name}`,
          `الحساب: ${result.integration.login ? `@${result.integration.login}` : "غير متاح"}`,
          `آخر تحقق: ${result.integration.lastVerifiedAt ? new Date(result.integration.lastVerifiedAt).toLocaleString("ar-SA") : "غير متاح"}`,
          "",
          ...result.repositories.map((repo, index) => [
            `${index + 1}. ${repo.fullName}`,
            `الخصوصية: ${repo.private ? "خاص" : "عام"}`,
            `الفرع الافتراضي: ${repo.defaultBranch}`,
            `اللغة: ${repo.language ?? "غير محددة"}`,
            `آخر تحديث في GitHub: ${new Date(repo.updatedAt).toLocaleString("ar-SA")}`,
          ].join("\n")),
        ].join("\n\n"),
        actions: [
          ...result.repositories.slice(0, 10).map((repo) => [{ id: `cc.repo:${repo.id}`, title: repo.name.slice(0, 55) }]),
          [{ id: "cc.repos", title: "تحديث" }, { id: "cc.home", title: "الرئيسية" }],
        ],
        editCurrent: Boolean(input.actionId),
      });
      return { handled: true, session: input.session };
    } catch (error) {
      if (error instanceof ApiError && error.code === "GITHUB_NOT_CONFIGURED") {
        await sendChannelClientView(input.transport, channelEmptyState({
          title: "GitHub غير متصل",
          reason: "لا يوجد تكامل GitHub مفعّل ومتحقق لهذه المؤسسة. لا تُدخل أي Token داخل القناة.",
          action: { id: "cc.home", title: "الرئيسية" },
          path: ["الرئيسية", "GitHub والمستودعات"],
        }));
        return { handled: true, session: input.session };
      }
      throw error;
    }
  }

  const repositoryId = Number(action?.slice("cc.repo:".length));
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) throw new ApiError(400, "GITHUB_REPOSITORY_ID_INVALID", "معرف المستودع غير صالح.");
  const result = await findOrganizationGitHubRepository({
    organizationId: input.identity.organizationId,
    userId: input.identity.userId,
    repositoryId,
  });
  const repo = result.repository;
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "GitHub والمستودعات", repo.name],
    text: [
      repo.fullName,
      repo.description || "بدون وصف",
      `الخصوصية: ${repo.private ? "خاص" : "عام"}`,
      `الفرع الافتراضي: ${repo.defaultBranch}`,
      `اللغة: ${repo.language ?? "غير محددة"}`,
      `الحجم: ${repo.sizeKb === null ? "غير متاح" : `${repo.sizeKb} KB`}`,
      `آخر تحديث: ${new Date(repo.updatedAt).toLocaleString("ar-SA")}`,
      `صلاحيات GitHub: قراءة ${repo.permissions?.pull === false ? "غير متاحة" : "متاحة"}، كتابة ${repo.permissions?.push ? "متاحة" : "غير متاحة"}`,
    ].join("\n"),
    actions: [[
      { id: "cc.repos", title: "رجوع" },
      { url: "/dashboard/repositories", title: "فتح في الموقع" },
    ]],
    editCurrent: Boolean(input.actionId),
  });
  return { handled: true, session: input.session };
}
