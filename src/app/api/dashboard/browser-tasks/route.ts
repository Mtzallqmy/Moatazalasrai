import { z } from "zod";
import { requireSession } from "@/lib/auth/authorization";
import {
  browserTaskCancelSchema,
  browserTaskCreateSchema,
} from "@/lib/browser/contracts";
import {
  cancelBrowserTask,
  createBrowserTask,
  getBrowserTask,
  listBrowserTasks,
} from "@/lib/browser/task-service";
import {
  apiSuccess,
  assertSameOrigin,
  getRequestId,
  handleApiError,
  parseJson,
} from "@/lib/http/api";
import { hydrateRuntimeControlPlane } from "@/lib/platform/runtime-control";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    await hydrateRuntimeControlPlane();
    const session = await requireSession("browser_tasks:read");
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const result = id
      ? await getBrowserTask({
        organizationId: session.organizationId,
        userId: session.userId,
        role: session.role,
        browserTaskId: z.string().uuid().parse(id),
      })
      : await listBrowserTasks({
        organizationId: session.organizationId,
        userId: session.userId,
        role: session.role,
        status: url.searchParams.get("status") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 50),
      });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/browser-tasks");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    await hydrateRuntimeControlPlane();
    const session = await requireSession("browser_tasks:run");
    await enforceRateLimit({
      scope: "browser-tasks:create",
      key: `${session.organizationId}:${session.userId}`,
      limit: 30,
      windowMs: 15 * 60_000,
    });
    const body = await parseJson(request, browserTaskCreateSchema, 16 * 1024);
    const result = await createBrowserTask({
      organizationId: session.organizationId,
      userId: session.userId,
      requestId,
      body,
    });
    return apiSuccess(result, requestId, 202);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/browser-tasks");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    await hydrateRuntimeControlPlane();
    const session = await requireSession("browser_tasks:run");
    const body = await parseJson(request, browserTaskCancelSchema, 4 * 1024);
    const result = await cancelBrowserTask({
      organizationId: session.organizationId,
      userId: session.userId,
      role: session.role,
      browserTaskId: body.browserTaskId,
      requestId,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/browser-tasks");
  }
}
