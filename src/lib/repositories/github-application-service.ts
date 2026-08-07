import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { assertUserPermission } from "@/lib/auth/user-authorization";
import { ApiError } from "@/lib/http/api";
import {
  listGitHubRepositories,
  readGitHubContents,
  type GitHubContentItem,
  type GitHubRepository,
} from "@/lib/integrations/github";
import { decryptSecret } from "@/lib/security/encryption";

async function configuredGitHub(organizationId: string) {
  const [integration] = await db().select().from(integrations).where(and(
    eq(integrations.organizationId, organizationId),
    eq(integrations.kind, "github"),
    eq(integrations.enabled, true),
    eq(integrations.status, "verified"),
  )).orderBy(desc(integrations.lastVerifiedAt)).limit(1);
  if (!integration) {
    throw new ApiError(409, "GITHUB_NOT_CONFIGURED", "لا يوجد تكامل GitHub مفعّل ومتحقق لهذه المؤسسة.");
  }
  return integration;
}

function sanitizedIntegration(integration: Awaited<ReturnType<typeof configuredGitHub>>) {
  return {
    name: integration.name,
    login: typeof integration.config.login === "string" ? integration.config.login : null,
    lastVerifiedAt: integration.lastVerifiedAt,
    status: integration.status,
  };
}

function sanitizedRepository(repo: GitHubRepository) {
  return {
    id: repo.id,
    fullName: repo.full_name,
    owner: repo.owner.login,
    name: repo.name,
    private: repo.private,
    defaultBranch: repo.default_branch,
    description: repo.description ?? null,
    language: repo.language ?? null,
    sizeKb: repo.size ?? null,
    permissions: repo.permissions ?? null,
    updatedAt: repo.updated_at,
  };
}

async function githubCredential(input: { organizationId: string; userId: string }) {
  await assertUserPermission({ ...input, permission: "integrations:read" });
  const integration = await configuredGitHub(input.organizationId);
  const token = decryptSecret(integration.encryptedToken, `integration:${input.organizationId}`);
  return { integration, token };
}

export async function listOrganizationGitHubRepositories(input: {
  organizationId: string;
  userId: string;
  limit?: number;
}) {
  const { integration, token } = await githubCredential(input);
  const repositories = await listGitHubRepositories(token, input.limit ?? 20);
  return {
    integration: sanitizedIntegration(integration),
    repositories: repositories.map(sanitizedRepository),
  };
}

export async function findOrganizationGitHubRepository(input: {
  organizationId: string;
  userId: string;
  repositoryId: number;
}) {
  const result = await listOrganizationGitHubRepositories({ ...input, limit: 50 });
  const repository = result.repositories.find((item) => item.id === input.repositoryId);
  if (!repository) throw new ApiError(404, "GITHUB_REPOSITORY_NOT_FOUND", "المستودع غير موجود ضمن المستودعات المتاحة للتكامل الحالي.");
  return { integration: result.integration, repository };
}

export async function readOrganizationGitHubContents(input: {
  organizationId: string;
  userId: string;
  owner: string;
  repo: string;
  path?: string;
  ref?: string;
}) {
  const { token } = await githubCredential(input);
  const contents = await readGitHubContents(token, input.owner, input.repo, input.path ?? "", input.ref);
  if (Array.isArray(contents)) {
    return {
      kind: "directory" as const,
      items: contents
        .map((item: GitHubContentItem) => ({
          type: item.type,
          name: item.name,
          path: item.path,
          sha: item.sha,
          size: item.size ?? null,
          htmlUrl: item.html_url ?? null,
        }))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1)),
    };
  }
  const decoded = contents.encoding === "base64" && contents.content
    ? Buffer.from(contents.content.replace(/\s/g, ""), "base64").toString("utf8")
    : contents.content ?? "";
  if (Buffer.byteLength(decoded, "utf8") > 1_000_000) {
    throw new ApiError(413, "GITHUB_FILE_TOO_LARGE", "معاينة الملفات الأكبر من 1 ميجابايت غير متاحة.");
  }
  return {
    kind: "file" as const,
    file: {
      name: contents.name,
      path: contents.path,
      sha: contents.sha,
      size: contents.size ?? Buffer.byteLength(decoded, "utf8"),
      content: decoded,
      htmlUrl: contents.html_url ?? null,
    },
  };
}
