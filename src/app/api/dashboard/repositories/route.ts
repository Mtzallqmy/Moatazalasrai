import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { listGitHubRepositories, readGitHubContents } from "@/lib/integrations/github";
import { decryptSecret } from "@/lib/security/encryption";

export const runtime = "nodejs";

const querySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), limit: z.coerce.number().int().min(1).max(50).default(50) }),
  z.object({
    action: z.literal("contents"),
    owner: z.string().regex(/^[A-Za-z0-9_.-]+$/).max(100),
    repo: z.string().regex(/^[A-Za-z0-9_.-]+$/).max(100),
    path: z.string().max(1000).default(""),
    ref: z.string().max(200).optional(),
  }),
]);

async function configuredGitHub(organizationId: string) {
  const [integration] = await db().select().from(integrations).where(and(
    eq(integrations.organizationId, organizationId),
    eq(integrations.kind, "github"),
    eq(integrations.enabled, true),
    eq(integrations.status, "verified"),
  )).orderBy(desc(integrations.lastVerifiedAt)).limit(1);
  if (!integration) {
    throw new ApiError(409, "GITHUB_NOT_CONFIGURED", "فعّل تكامل GitHub واختبر الاتصال أولًا.");
  }
  return integration;
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("integrations:read");
    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const integration = await configuredGitHub(session.organizationId);
    const token = decryptSecret(integration.encryptedToken, `integration:${session.organizationId}`);

    if (parsed.action === "list") {
      const repositories = await listGitHubRepositories(token, parsed.limit);
      return apiSuccess({
        integration: {
          id: integration.id,
          name: integration.name,
          login: typeof integration.config.login === "string" ? integration.config.login : null,
          lastVerifiedAt: integration.lastVerifiedAt,
        },
        repositories: repositories.map((repo) => ({
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
        })),
      }, requestId);
    }

    const contents = await readGitHubContents(token, parsed.owner, parsed.repo, parsed.path, parsed.ref);
    if (Array.isArray(contents)) {
      return apiSuccess({
        kind: "directory" as const,
        items: contents
          .map((item) => ({
            type: item.type,
            name: item.name,
            path: item.path,
            sha: item.sha,
            size: item.size ?? null,
            htmlUrl: item.html_url ?? null,
          }))
          .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1)),
      }, requestId);
    }

    const decoded = contents.encoding === "base64" && contents.content
      ? Buffer.from(contents.content.replace(/\s/g, ""), "base64").toString("utf8")
      : contents.content ?? "";
    if (Buffer.byteLength(decoded, "utf8") > 1_000_000) {
      throw new ApiError(413, "GITHUB_FILE_TOO_LARGE", "معاينة الملفات الأكبر من 1 ميجابايت غير متاحة في المتصفح.");
    }
    return apiSuccess({
      kind: "file" as const,
      file: {
        name: contents.name,
        path: contents.path,
        sha: contents.sha,
        size: contents.size ?? Buffer.byteLength(decoded, "utf8"),
        content: decoded,
        htmlUrl: contents.html_url ?? null,
      },
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/repositories");
  }
}
