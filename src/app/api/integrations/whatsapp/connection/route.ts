import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError } from "@/lib/http/api";
import { requireWhatsAppConfig } from "@/lib/integrations/whatsapp/config";
import { sendTextMessage } from "@/lib/integrations/whatsapp/client";
import { disconnectWhatsAppForUser } from "@/lib/integrations/whatsapp/linking";
import { hydrateRuntimeForRequest } from "@/lib/platform/runtime-hydration";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    await hydrateRuntimeForRequest();
    requireWhatsAppConfig();
    const session = await requireSession();
    await enforceRateLimit({
      scope: "whatsapp.disconnect.user",
      key: session.userId,
      limit: 10,
      windowMs: 60 * 60_000,
    });
    const result = await disconnectWhatsAppForUser({
      userId: session.userId,
      organizationId: session.organizationId,
      requestId,
    });
    if (result.waId) {
      await sendTextMessage({
        to: result.waId,
        text: "تم إلغاء ربط هذا الرقم بحسابك في منصة معتز. لن تُعرض معلومات الحساب قبل إعادة الربط.",
      }).catch(() => undefined);
    }
    return apiSuccess({ disconnected: true, changed: result.disconnected }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/integrations/whatsapp/connection");
  }
}
