import { z } from "zod";
import { requireSession } from "@/lib/auth/authorization";
import { browserLoginStartSchema } from "@/lib/browser/contracts";
import {
  beginBrowserLogin,
  cancelBrowserLogin,
  getBrowserLoginStatus,
  listBrowserLoginSessions,
} from "@/lib/browser/login-service";
import {
  apiSuccess,
  assertSameOrigin,
  getRequestId,
  handleApiError,
  parseJson,
} from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const sessionSchema = z.object({ sessionId: z.string().uuid() }).strict();

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("site_connections:manage");
    const sessionId = new URL(request.url).searchParams.get("sessionId");
    const result = sessionId
      ? await getBrowserLoginStatus({
        organizationId: session.organizationId,
        userId: session.userId,
        sessionId: z.string().uuid().parse(sessionId),
        requestId,
      })
      : await listBrowserLoginSessions({ organizationId: session.organizationId, userId: session.userId });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/site-connections/browser/login");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("site_connections:manage");
    await enforceRateLimit({
      scope: "browser-login:start",
      key: `${session.organizationId}:${session.userId}`,
      limit: 10,
      windowMs: 60 * 60_000,
    });
    const body = await parseJson(request, browserLoginStartSchema, 8 * 1024);
    const result = await beginBrowserLogin({
      organizationId: session.organizationId,
      userId: session.userId,
      requestId,
      body,
    });
    return apiSuccess(result, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/site-connections/browser/login");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("site_connections:manage");
    const body = await parseJson(request, sessionSchema, 4 * 1024);
    const result = await cancelBrowserLogin({
      organizationId: session.organizationId,
      userId: session.userId,
      sessionId: body.sessionId,
      requestId,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/site-connections/browser/login");
  }
}
