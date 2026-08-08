import { z } from "zod";
import { rotateMobileSession } from "@/lib/auth/mobile";
import { apiSuccess, ApiError, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { supabaseAuthConfigured } from "@/lib/supabase/config";

const schema = z.object({ refreshToken: z.string().startsWith("mrt_").max(200) }).strict();

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    if (supabaseAuthConfigured()) throw new ApiError(410, "SUPABASE_AUTH_REQUIRED", "حدّث الجلسة بواسطة Supabase Auth SDK.");
    const body = await parseJson(request, schema, 4 * 1024);
    return apiSuccess({ tokens: await rotateMobileSession(body.refreshToken) }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/mobile/v1/auth/refresh");
  }
}
