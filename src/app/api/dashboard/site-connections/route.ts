import { requireSession } from "@/lib/auth/authorization";
import {
  siteConnectionCreateSchema,
  siteConnectionDeleteSchema,
  siteConnectionIdSchema,
  siteConnectionUpdateSchema,
} from "@/lib/site-connections/contracts";
import {
  createSiteConnection,
  deleteSiteConnection,
  getSiteConnection,
  listSiteConnections,
  updateSiteConnection,
} from "@/lib/site-connections/service";
import {
  apiSuccess,
  assertSameOrigin,
  getRequestId,
  handleApiError,
  parseJson,
} from "@/lib/http/api";
import { hydrateRuntimeControlPlane } from "@/lib/platform/runtime-control";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    await hydrateRuntimeControlPlane();
    const session = await requireSession("site_connections:read");
    const id = new URL(request.url).searchParams.get("id");
    const data = id
      ? await getSiteConnection(session.organizationId, siteConnectionIdSchema.parse(id))
      : await listSiteConnections(session.organizationId);
    return apiSuccess(data, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/site-connections");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    await hydrateRuntimeControlPlane();
    const session = await requireSession("site_connections:manage");
    await enforceRateLimit({
      scope: "site-connections:create",
      key: `${session.organizationId}:${session.userId}:${requestClientKey(request)}`,
      limit: 10,
      windowMs: 15 * 60_000,
    });
    const body = await parseJson(request, siteConnectionCreateSchema, 32 * 1024);
    const connection = await createSiteConnection({
      organizationId: session.organizationId,
      userId: session.userId,
      requestId,
      body,
    });
    return apiSuccess(connection, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/site-connections");
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    await hydrateRuntimeControlPlane();
    const session = await requireSession("site_connections:manage");
    await enforceRateLimit({
      scope: "site-connections:update",
      key: `${session.organizationId}:${session.userId}`,
      limit: 30,
      windowMs: 15 * 60_000,
    });
    const body = await parseJson(request, siteConnectionUpdateSchema, 24 * 1024);
    const connection = await updateSiteConnection({
      organizationId: session.organizationId,
      userId: session.userId,
      requestId,
      body,
    });
    return apiSuccess(connection, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/site-connections");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    await hydrateRuntimeControlPlane();
    const session = await requireSession("site_connections:manage");
    const body = await parseJson(request, siteConnectionDeleteSchema, 4 * 1024);
    const result = await deleteSiteConnection({
      organizationId: session.organizationId,
      userId: session.userId,
      connectionId: body.id,
      requestId,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/site-connections");
  }
}
