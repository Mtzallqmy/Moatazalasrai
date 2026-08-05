// Organization-scoped channel administration API; WhatsApp is synchronized from the platform environment.
import { z } from "zod";
import {
  channelConnectionUpdateSchema,
  deleteChannelConnection,
  listChannelAdministration,
  updateChannelConnection,
} from "@/lib/channels/admin";
import { ensureOrganizationWhatsAppProjection } from "@/lib/channels/whatsapp-platform";
import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deleteSchema = z.object({ connectionId: z.string().uuid() }).strict();

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("channels:read");
    await ensureOrganizationWhatsAppProjection(session.organizationId).catch(() => undefined);
    return apiSuccess(await listChannelAdministration(session.organizationId), requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/channels");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("channels:manage");
    await enforceRateLimit({
      scope: "channels:sync",
      key: `${session.organizationId}:${session.userId}:${requestClientKey(request)}`,
      limit: 20,
      windowMs: 15 * 60_000,
    });
    const connection = await ensureOrganizationWhatsAppProjection(session.organizationId);
    return apiSuccess({
      connection,
      synchronized: true,
      credentialSource: "environment",
      manualCreationAllowed: false,
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/channels");
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("channels:manage");
    const update = await parseJson(request, channelConnectionUpdateSchema, 64 * 1024);
    const result = await updateChannelConnection({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      update,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/channels");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("channels:manage");
    const body = await parseJson(request, deleteSchema, 4 * 1024);
    return apiSuccess(await deleteChannelConnection({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      connectionId: body.connectionId,
    }), requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/channels");
  }
}
