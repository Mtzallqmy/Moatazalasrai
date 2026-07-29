import { z } from "zod";
import { revokeMobileSession } from "@/lib/auth/mobile";
import { apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";

const schema = z.object({ refreshToken: z.string().startsWith("mrt_").max(200) }).strict();

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const body = await parseJson(request, schema, 4 * 1024);
    await revokeMobileSession(body.refreshToken);
    return apiSuccess({ revoked: true }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/mobile/v1/auth/logout");
  }
}
