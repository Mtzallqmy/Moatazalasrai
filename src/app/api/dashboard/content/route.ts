import { assertSessionPermission, requireSession, type Permission } from "@/lib/auth/authorization";
import { contentOperationSchema, type ContentOperation } from "@/lib/admin/content-contracts";
import { executeContentOperation, loadContentManager } from "@/lib/admin/content-service";
import { requireModuleActive } from "@/lib/control-plane/modules";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function permissionFor(operation: ContentOperation): Permission {
  if (operation.operation === "page.purge") return "trash:manage";
  if (operation.operation === "service.upsert" || operation.operation.startsWith("service.")) return "services:manage";
  if (operation.operation === "menu.upsert" || operation.operation.startsWith("menu_item.")) return "menus:manage";
  if (operation.operation === "page.upsert" && operation.status === "published") return "content:publish";
  return "content:manage";
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("content:read");
    await requireModuleActive(session.organizationId, "content_management");
    return apiSuccess(await loadContentManager(session.organizationId), requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/content");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    await requireModuleActive(session.organizationId, "content_management");
    await enforceRateLimit({
      scope: "dashboard.content.mutate",
      key: `${session.organizationId}:${session.userId}:${requestClientKey(request)}`,
      limit: 180,
      windowMs: 60_000,
    });
    const operation = await parseJson(request, contentOperationSchema, 256 * 1024);
    await assertSessionPermission(session, permissionFor(operation));
    const result = await executeContentOperation({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      operation,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/content");
  }
}
