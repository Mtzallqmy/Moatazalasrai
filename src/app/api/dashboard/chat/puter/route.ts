import { requireSession } from "@/lib/auth/authorization";
import { puterChatFinishSchema, puterChatStartSchema } from "@/lib/puter/contracts";
import { isPuterEnabled } from "@/lib/puter/feature";
import { finishPuterChat, startPuterChat } from "@/lib/puter/server-runtime";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

function requirePuterFeature() {
  if (!isPuterEnabled()) throw new ApiError(404, "FEATURE_DISABLED", "ميزة Puter غير مفعلة.");
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    requirePuterFeature();
    assertSameOrigin(request);
    const session = await requireSession("agents:run");
    await enforceRateLimit({
      scope: "puter-chat:start",
      key: `${session.organizationId}:${session.userId}:${requestClientKey(request)}`,
      limit: 30,
      windowMs: 15 * 60_000,
    });
    const body = await parseJson(request, puterChatStartSchema, 20 * 1024);
    const result = await startPuterChat({
      organizationId: session.organizationId,
      userId: session.userId,
      role: session.role,
      requestId,
      ...body,
    });
    return apiSuccess(result, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/chat/puter");
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    requirePuterFeature();
    assertSameOrigin(request);
    const session = await requireSession("agents:run");
    await enforceRateLimit({
      scope: "puter-chat:finish",
      key: `${session.organizationId}:${session.userId}:${requestClientKey(request)}`,
      limit: 60,
      windowMs: 15 * 60_000,
    });
    const body = await parseJson(request, puterChatFinishSchema, 72 * 1024);
    const result = await finishPuterChat({
      organizationId: session.organizationId,
      userId: session.userId,
      role: session.role,
      requestId,
      ...body,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/chat/puter");
  }
}
