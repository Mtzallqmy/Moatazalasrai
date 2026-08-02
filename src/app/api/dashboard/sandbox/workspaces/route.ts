import { requireSession } from "@/lib/auth/authorization";
import {
  sandboxWorkspaceActionSchema,
  sandboxWorkspaceCreateSchema,
} from "@/lib/sandbox/contracts";
import {
  createSandboxWorkspace,
  listSandboxWorkspaces,
  resetSandboxWorkspace,
  terminateSandboxWorkspace,
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
    const conversationId = new URL(request.url).searchParams.get("conversationId") ?? undefined;
    const rows = await listSandboxWorkspaces({
      actor: { organizationId: session.organizationId, userId: session.userId, role: session.role },
      conversationId,
    });
    return apiSuccess(rows, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/sandbox/workspaces");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("sandbox:use");
    await enforceRateLimit({
      scope: "sandbox-workspaces:create",
      key: `${session.organizationId}:${session.userId}`,
      limit: 10,
      windowMs: 60 * 60_000,
    });
    const body = await parseJson(request, sandboxWorkspaceCreateSchema, 16 * 1024);
    const result = await createSandboxWorkspace({
      actor: { organizationId: session.organizationId, userId: session.userId, role: session.role },
      requestId,
      body,
    });
    return apiSuccess(result, requestId, 202);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/sandbox/workspaces");
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("sandbox:manage");
    const body = await parseJson(request, sandboxWorkspaceActionSchema, 4 * 1024);
    const actor = { organizationId: session.organizationId, userId: session.userId, role: session.role };
    const result = body.action === "reset"
      ? await resetSandboxWorkspace({ actor, workspaceId: body.workspaceId, requestId })
      : await terminateSandboxWorkspace({ actor, workspaceId: body.workspaceId, requestId });
    return apiSuccess(result, requestId, body.action === "reset" ? 202 : 200);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/sandbox/workspaces");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("sandbox:manage");
    const body = await parseJson(request, sandboxWorkspaceActionSchema, 4 * 1024);
    const result = await terminateSandboxWorkspace({
      actor: { organizationId: session.organizationId, userId: session.userId, role: session.role },
      workspaceId: body.workspaceId,
      requestId,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/sandbox/workspaces");
  }
}
