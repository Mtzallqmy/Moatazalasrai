import { z } from "zod";
import { mobileMe } from "@/lib/auth/mobile";
import { verifyMobileMfaChallenge } from "@/lib/auth/mobile-mfa";
import { apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

const schema = z.object({
  challengeToken: z.string().trim().min(20).max(200),
  code: z.string().trim().min(6).max(32),
}).strict();

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const body = await parseJson(request, schema, 4 * 1024);
    await enforceRateLimit({ scope: "mobile.mfa.verify.ip", key: requestClientKey(request), limit: 15, windowMs: 15 * 60_000 });
    await enforceRateLimit({ scope: "mobile.mfa.verify.challenge", key: body.challengeToken.slice(0, 32), limit: 8, windowMs: 15 * 60_000 });
    const result = await verifyMobileMfaChallenge(body);
    const identity = await mobileMe(result.userId, result.organizationId);
    return apiSuccess({
      tokens: result.tokens,
      user: identity ? { id: identity.id, email: identity.email, name: identity.name } : { id: result.userId },
      organization: identity ? { id: identity.organizationId, name: identity.organizationName, role: identity.role } : { id: result.organizationId },
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/mobile/v1/auth/mfa/verify");
  }
}
