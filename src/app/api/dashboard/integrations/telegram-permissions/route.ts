import { z } from "zod";
import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { setTelegramFeaturePermission, TELEGRAM_FEATURE_KEYS } from "@/lib/integrations/telegram-platform";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

const schema = z.object({
  userId: z.string().uuid(),
  featureKey: z.enum(TELEGRAM_FEATURE_KEYS),
  enabled: z.boolean(),
  limits: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("integrations:manage");
    await enforceRateLimit({
      scope: "telegram.permission.update",
      key: `${session.organizationId}:${session.userId}:${requestClientKey(request)}`,
      limit: 120,
      windowMs: 15 * 60_000,
    });
    const body = await parseJson(request, schema, 16 * 1024);
    return apiSuccess(await setTelegramFeaturePermission({
      ...body,
      organizationId: session.organizationId,
      actorUserId: session.userId,
    }), requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/integrations/telegram-permissions");
  }
}
