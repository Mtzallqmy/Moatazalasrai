import { z } from "zod";
import { requireSession } from "@/lib/auth/authorization";
import { beginGoogleOAuth } from "@/lib/site-connections/google-oauth";
import {
  apiSuccess,
  assertSameOrigin,
  getRequestId,
  handleApiError,
  parseJson,
} from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const schema = z.object({
  name: z.string().trim().min(2).max(120).default("حساب Google"),
}).strict();

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("site_connections:manage");
    await enforceRateLimit({
      scope: "google-oauth:start",
      key: `${session.organizationId}:${session.userId}`,
      limit: 10,
      windowMs: 60 * 60_000,
    });
    const body = await parseJson(request, schema, 4 * 1024);
    const result = await beginGoogleOAuth({
      organizationId: session.organizationId,
      userId: session.userId,
      name: body.name,
      requestId,
    });
    return apiSuccess(result, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/site-connections/google/start");
  }
}
