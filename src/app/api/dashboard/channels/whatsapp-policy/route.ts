import { requireSession } from "@/lib/auth/authorization";
import {
  getWhatsAppPolicyAdministration,
  updateWhatsAppPolicy,
  whatsappPolicyQuerySchema,
  whatsappPolicyUpdateSchema,
} from "@/lib/channels/whatsapp-policy-admin";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("channels:read");
    const url = new URL(request.url);
    const query = whatsappPolicyQuerySchema.parse({
      userId: url.searchParams.get("userId") || undefined,
    });
    return apiSuccess(await getWhatsAppPolicyAdministration({
      organizationId: session.organizationId,
      userId: query.userId,
    }), requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/channels/whatsapp-policy");
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("channels:manage");
    await enforceRateLimit({
      scope: "whatsapp.policy.update",
      key: `${session.organizationId}:${session.userId}:${requestClientKey(request)}`,
      limit: 60,
      windowMs: 15 * 60_000,
    });
    const update = await parseJson(request, whatsappPolicyUpdateSchema, 96 * 1024);
    return apiSuccess(await updateWhatsAppPolicy({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      actorRole: session.role,
      update,
    }), requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/channels/whatsapp-policy");
  }
}
