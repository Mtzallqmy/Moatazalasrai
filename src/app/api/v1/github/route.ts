import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { listGitHubRepositories, readGitHubFile } from "@/lib/integrations/github";
import { decryptSecret } from "@/lib/security/encryption";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_repositories"), limit: z.number().int().min(1).max(50).default(20) }).strict(),
  z.object({
    action: z.literal("read_file"),
    owner: z.string().regex(/^[A-Za-z0-9_.-]+$/).max(100),
    repo: z.string().regex(/^[A-Za-z0-9_.-]+$/).max(100),
    path: z.string().min(1).max(1000),
    ref: z.string().max(200).optional(),
  }).strict(),
]);

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    const body = await parseJson(request, actionSchema, 16 * 1024);
    const [github] = await db().select().from(integrations).where(and(
      eq(integrations.organizationId, principal.organizationId),
      eq(integrations.kind, "github"),
      eq(integrations.enabled, true),
      eq(integrations.status, "verified"),
    )).limit(1);
    if (!github) throw new ApiError(409, "GITHUB_NOT_CONFIGURED", "فعّل تكامل GitHub أولًا.");
    const token = decryptSecret(github.encryptedToken);
    if (body.action === "list_repositories") {
      const repositories = await listGitHubRepositories(token, body.limit);
      return apiSuccess({ repositories }, requestId);
    }
    const file = await readGitHubFile(token, body.owner, body.repo, body.path, body.ref);
    const content = file.encoding === "base64" && file.content
      ? Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8")
      : file.content;
    return apiSuccess({ file: { ...file, content } }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/github");
  }
}
