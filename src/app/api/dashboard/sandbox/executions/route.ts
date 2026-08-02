import { requireSession } from "@/lib/auth/authorization";
import {
  sandboxExecutionCancelSchema,
  sandboxExecutionCreateSchema,
} from "@/lib/sandbox/contracts";
import {
  cancelSandboxExecution,
  createSandboxExecution,
  listSandboxExecutions,
} from "@/lib/sandbox/service";
import {
  apiSuccess,
  assertSameOrigin,
  getRequestId,
  handleApiError,
  parseJson,
} from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("sandbox:read");
    const url = new URL(request.url);
    const rows = await listSandboxExecutions({
      actor: { organizationId: session.organizationId, userId: session.userId, role: session.role },
      conversationId: url.searchParams.get("conversationId") ?? undefined,
      workspaceId: url.searchParams.get("workspaceId") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 50),
    });
    return apiSuccess(rows, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/sandbox/executions");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("sandbox:use");
    await enforceRateLimit({
      scope: "sandbox-executions:create",
      key: `${session.organizationId}:${session.userId}`,
      limit: 60,
      windowMs: 15 * 60_000,
    });
    const body = await parseJson(request, sandboxExecutionCreateSchema, 32 * 1024);
    const result = await createSandboxExecution({
      actor: { organizationId: session.organizationId, userId: session.userId, role: session.role },
      requestId,
      body,
    });
    return apiSuccess(result, requestId, 202);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/sandbox/executions");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("sandbox:use");
    const body = await parseJson(request, sandboxExecutionCancelSchema, 4 * 1024);
    const result = await cancelSandboxExecution({
      actor: { organizationId: session.organizationId, userId: session.userId, role: session.role },
      executionId: body.executionId,
      requestId,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/sandbox/executions");
  }
}
