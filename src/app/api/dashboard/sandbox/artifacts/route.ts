import { z } from "zod";
import { requireSession } from "@/lib/auth/authorization";
import { exportSandboxArtifact } from "@/lib/sandbox/artifacts";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";

const schema = z.object({
  workspaceId: z.string().uuid(),
  path: z.string().trim().min(1).max(1_000),
}).strict();

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("sandbox:manage");
    const body = await parseJson(request, schema, 8 * 1024);
    const result = await exportSandboxArtifact({
      actor: { organizationId: session.organizationId, userId: session.userId, role: session.role },
      workspaceId: body.workspaceId,
      path: body.path,
      requestId,
    });
    return apiSuccess(result, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/sandbox/artifacts");
  }
}
