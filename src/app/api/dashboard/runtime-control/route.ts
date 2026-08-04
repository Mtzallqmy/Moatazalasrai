import { z } from "zod";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import {
  apiSuccess,
  assertSameOrigin,
  getRequestId,
  handleApiError,
  parseJson,
} from "@/lib/http/api";
import {
  hydrateRuntimeControlPlane,
  runtimeControlUpdateSchema,
  saveRuntimeControl,
  testCurrentRuntimeFeature,
} from "@/lib/platform/runtime-control";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const testSchema = z.object({
  feature: z.enum(["whatsapp", "sandbox", "browser"]),
}).strict();

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    await requireSession("organization:manage");
    const snapshot = await hydrateRuntimeControlPlane(true);
    return apiSuccess(snapshot, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/runtime-control");
  }
}

export async function PUT(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("organization:manage");
    await enforceRateLimit({
      scope: "runtime-control:update",
      key: `${session.organizationId}:${session.userId}:${requestClientKey(request)}`,
      limit: 20,
      windowMs: 15 * 60_000,
    });
    const body = await parseJson(request, runtimeControlUpdateSchema, 48 * 1024);
    const snapshot = await saveRuntimeControl(body, session.userId);
    await db().insert(auditLogs).values({
      organizationId: session.organizationId,
      actorType: "user",
      actorId: session.userId,
      action: "platform.runtime_control_updated",
      resourceType: "platform_runtime_settings",
      resourceId: body.feature,
      metadata: {
        feature: body.feature,
        enabled: body.enabled,
        requestId,
      },
    });
    return apiSuccess(snapshot, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/runtime-control");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("organization:manage");
    await enforceRateLimit({
      scope: "runtime-control:test",
      key: `${session.organizationId}:${session.userId}`,
      limit: 30,
      windowMs: 15 * 60_000,
    });
    const body = await parseJson(request, testSchema, 4 * 1024);
    const result = await testCurrentRuntimeFeature(body.feature);
    return apiSuccess(result, requestId, result.status === "healthy" ? 200 : 503);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/runtime-control");
  }
}
