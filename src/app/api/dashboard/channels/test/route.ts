// Runs a real transport health check or sends an audited test message.
import { z } from "zod";
import { requireSession } from "@/lib/auth/authorization";
import { sendChannelTestMessage, testChannelConnection } from "@/lib/channels/admin";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("health"), connectionId: z.string().uuid() }).strict(),
  z.object({
    action: z.literal("message"),
    connectionId: z.string().uuid(),
    to: z.string().trim().min(3).max(80),
    text: z.string().trim().min(1).max(2_000),
  }).strict(),
]);

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("channels:manage");
    await enforceRateLimit({
      scope: "channels:test",
      key: `${session.organizationId}:${session.userId}`,
      limit: 30,
      windowMs: 15 * 60_000,
    });
    const body = await parseJson(request, schema, 8 * 1024);
    const result = body.action === "health"
      ? await testChannelConnection(session.organizationId, body.connectionId)
      : await sendChannelTestMessage({
          organizationId: session.organizationId,
          actorUserId: session.userId,
          connectionId: body.connectionId,
          to: body.to,
          text: body.text,
        });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/channels/test");
  }
}
