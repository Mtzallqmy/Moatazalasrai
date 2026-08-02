import { requireSession } from "@/lib/auth/authorization";
import {
  agentSiteConnectionDeleteSchema,
  agentSiteConnectionUpsertSchema,
} from "@/lib/site-connections/contracts";
import {
  removeAgentSiteConnection,
  upsertAgentSiteConnection,
} from "@/lib/site-connections/service";
import {
  apiSuccess,
  assertSameOrigin,
  getRequestId,
  handleApiError,
  parseJson,
} from "@/lib/http/api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("site_connections:manage");
    const body = await parseJson(request, agentSiteConnectionUpsertSchema, 16 * 1024);
    const connection = await upsertAgentSiteConnection({
      organizationId: session.organizationId,
      userId: session.userId,
      requestId,
      body,
    });
    return apiSuccess(connection, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/site-connections/agents");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("site_connections:manage");
    const body = await parseJson(request, agentSiteConnectionDeleteSchema, 4 * 1024);
    const result = await removeAgentSiteConnection({
      organizationId: session.organizationId,
      userId: session.userId,
      connectionId: body.connectionId,
      agentId: body.agentId,
      requestId,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/site-connections/agents");
  }
}
