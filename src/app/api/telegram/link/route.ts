import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError } from "@/lib/http/api";
import { unlinkTelegramAccount } from "@/lib/integrations/telegram-platform";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("integrations:read");
    return apiSuccess(await unlinkTelegramAccount({
      userId: session.userId,
      organizationId: session.organizationId,
      actorUserId: session.userId,
    }), requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/telegram/link");
  }
}
