import { requireSession } from "@/lib/auth/authorization";
import { controlPlaneOperationSchema } from "@/lib/control-plane/contracts";
import { executeControlPlaneOperationV2, loadControlPlaneV2 } from "@/lib/control-plane/service-v2";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("control_plane:read");
    const data = await loadControlPlaneV2(session.organizationId);
    return apiSuccess(data, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/control-plane");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("control_plane:manage");
    await enforceRateLimit({
      scope: "dashboard.control-plane.mutate",
      key: `${session.organizationId}:${session.userId}:${requestClientKey(request)}`,
      limit: 120,
      windowMs: 60_000,
    });
    const operation = await parseJson(request, controlPlaneOperationSchema, 64 * 1024);
    const result = await executeControlPlaneOperationV2({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      operation,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/control-plane");
  }
}
