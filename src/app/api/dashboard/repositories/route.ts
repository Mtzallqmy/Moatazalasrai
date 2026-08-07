import { z } from "zod";
import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import {
  listOrganizationGitHubRepositories,
  readOrganizationGitHubContents,
} from "@/lib/repositories/github-application-service";

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

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("integrations:read");
    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    if (parsed.action === "list") {
      const result = await listOrganizationGitHubRepositories({
        organizationId: session.organizationId,
        userId: session.userId,
        limit: parsed.limit,
      });
      return apiSuccess(result, requestId);
    }
    const result = await readOrganizationGitHubContents({
      organizationId: session.organizationId,
      userId: session.userId,
      owner: parsed.owner,
      repo: parsed.repo,
      path: parsed.path,
      ref: parsed.ref,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/repositories");
  }
}
