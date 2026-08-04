import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { isWhatsAppIntegrationEnabled } from "@/lib/integrations/whatsapp/config";
import { whatsappConnectionStatus } from "@/lib/integrations/whatsapp/linking";
import { hydrateRuntimeForRequest } from "@/lib/platform/runtime-hydration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession();
    const runtimeState = await hydrateRuntimeForRequest();
    if (!isWhatsAppIntegrationEnabled()) {
      return apiSuccess({
        enabled: false,
        configured: runtimeState?.whatsapp.configured ?? false,
        connected: false,
        connectedAt: null,
        phoneNumberMasked: null,
      }, requestId);
    }
    const status = await whatsappConnectionStatus(session.userId);
    return apiSuccess({
      enabled: true,
      configured: true,
      connected: status.connected,
      connectedAt: status.connectedAt?.toISOString() ?? null,
      lastInteractionAt: status.lastInteractionAt?.toISOString() ?? null,
      phoneNumberMasked: status.phoneNumberMasked,
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/integrations/whatsapp/status");
  }
}
