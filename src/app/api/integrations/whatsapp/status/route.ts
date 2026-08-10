import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { isWhatsAppIntegrationEnabled, requireWhatsAppConfig } from "@/lib/integrations/whatsapp/config";
import { whatsappConnectionStatus } from "@/lib/integrations/whatsapp/linking";
import { testWhatsAppPhoneNumber } from "@/lib/integrations/whatsapp/client";
import { hydrateRuntimeForRequest } from "@/lib/platform/runtime-hydration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession();
    await hydrateRuntimeForRequest();
    if (!isWhatsAppIntegrationEnabled()) {
      return apiSuccess({
        enabled: false,
        connected: false,
        connectedAt: null,
        phoneNumberMasked: null,
      }, requestId);
    }
    const [status, platformHealth] = await Promise.all([
      whatsappConnectionStatus(session.userId),
      testWhatsAppPhoneNumber({ config: requireWhatsAppConfig() })
        .then((phone) => ({ ok: true as const, phone }))
        .catch((error) => ({
          ok: false as const,
          errorCode: error && typeof error === "object" && "code" in error ? String(error.code) : "WHATSAPP_HEALTH_FAILED",
        })),
    ]);
    const platformReady = platformHealth.ok;
    return apiSuccess({
      enabled: true,
      connected: status.connected && platformReady,
      connectionStored: status.connected,
      platformReady,
      healthErrorCode: platformHealth.ok ? null : platformHealth.errorCode,
      connectedAt: status.connectedAt?.toISOString() ?? null,
      lastInteractionAt: status.lastInteractionAt?.toISOString() ?? null,
      phoneNumberMasked: status.phoneNumberMasked,
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/integrations/whatsapp/status");
  }
}
