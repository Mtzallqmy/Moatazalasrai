import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { assertSiteConnectionsEnabled } from "@/lib/site-connections/service";
import { listSiteConnectors } from "@/server/site-connectors/registry";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    await requireSession("site_connections:read");
    assertSiteConnectionsEnabled();
    return apiSuccess(listSiteConnectors(), requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/site-connections/connectors");
  }
}
