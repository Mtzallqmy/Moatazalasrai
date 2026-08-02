import { z } from "zod";
import { requireSession } from "@/lib/auth/authorization";
import { revokeGoogleConnection } from "@/lib/site-connections/google-oauth";
import {
  apiSuccess,
  assertSameOrigin,
  getRequestId,
  handleApiError,
  parseJson,
} from "@/lib/http/api";

const schema = z.object({ connectionId: z.string().uuid() }).strict();

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("site_connections:manage");
    const body = await parseJson(request, schema, 4 * 1024);
    const result = await revokeGoogleConnection({
      organizationId: session.organizationId,
      userId: session.userId,
      connectionId: body.connectionId,
      requestId,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/site-connections/google/revoke");
  }
}
