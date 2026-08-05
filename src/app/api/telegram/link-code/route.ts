import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError } from "@/lib/http/api";
import { createTelegramLinkCode } from "@/lib/integrations/telegram-platform";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("integrations:read");
    await enforceRateLimit({
      scope: "telegram.link-code.create",
      key: `${session.organizationId}:${session.userId}:${requestClientKey(request)}`,
      limit: 5,
      windowMs: 15 * 60_000,
    });
    return apiSuccess(await createTelegramLinkCode({
      userId: session.userId,
      organizationId: session.organizationId,
      requestIp: requestClientKey(request),
      userAgent: request.headers.get("user-agent"),
    }), requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/telegram/link-code");
  }
}
