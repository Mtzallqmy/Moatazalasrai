import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { telegramLinkStatus } from "@/lib/integrations/telegram-platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("integrations:read");
    return apiSuccess(await telegramLinkStatus(session.userId, session.organizationId), requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/telegram/link-status");
  }
}
