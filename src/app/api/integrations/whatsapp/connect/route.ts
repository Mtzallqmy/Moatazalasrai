import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError } from "@/lib/http/api";
import { createWhatsAppConnectLink } from "@/lib/integrations/whatsapp/linking";
import { hydrateRuntimeControlPlane } from "@/lib/platform/runtime-control";
import { requestClientKey, enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    await hydrateRuntimeControlPlane();
    const session = await requireSession();
    await Promise.all([
      enforceRateLimit({
        scope: "whatsapp.connect.user",
        key: session.userId,
        limit: 5,
        windowMs: 10 * 60_000,
      }),
      enforceRateLimit({
        scope: "whatsapp.connect.ip",
        key: requestClientKey(request, session.userId),
        limit: 20,
        windowMs: 10 * 60_000,
      }),
    ]);
    const result = await createWhatsAppConnectLink({
      userId: session.userId,
      organizationId: session.organizationId,
      requestId,
    });
    if (!result.whatsappUrl.startsWith("https://wa.me/")) {
      throw new ApiError(500, "WHATSAPP_LINK_CREATE_FAILED", "تعذر إنشاء رابط WhatsApp بأمان.");
    }
    return apiSuccess({
      whatsappUrl: result.whatsappUrl,
      expiresAt: result.expiresAt.toISOString(),
    }, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/integrations/whatsapp/connect");
  }
}
