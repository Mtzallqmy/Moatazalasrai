import { z } from "zod";
import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { developerModeEnabled, setDeveloperMode } from "@/lib/preferences/developer-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({ enabled: z.boolean() }).strict();

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession();
    return apiSuccess({ enabled: await developerModeEnabled(session.userId) }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/preferences/developer-mode");
  }
}

export async function PUT(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    const body = await parseJson(request, updateSchema, 1024);
    return apiSuccess({ enabled: await setDeveloperMode(session.userId, body.enabled) }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/preferences/developer-mode");
  }
}
