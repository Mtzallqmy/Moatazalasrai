import { z } from "zod";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import {
  ApiError,
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
import {
  initializeWhatsAppFromEnvironment,
  inspectWhatsAppEnvironment,
} from "@/lib/platform/whatsapp-environment";
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
    await initializeWhatsAppFromEnvironment();
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
    if (body.feature === "whatsapp" && inspectWhatsAppEnvironment().authoritative) {
      throw new ApiError(
        409,
        "WHATSAPP_ENVIRONMENT_MANAGED",
        "إعدادات WhatsApp تُدار تلقائيًا من Environment Variables في Railway ولا يمكن استبدالها من الواجهة.",
      );
    }
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
    if (body.feature === "whatsapp" && inspectWhatsAppEnvironment().authoritative) {
      const report = await initializeWhatsAppFromEnvironment({ force: true });
      const result = report.health ?? {
        status: "invalid_configuration",
        checkedAt: report.checkedAt,
        latencyMs: 0,
        details: "متغيرات WhatsApp غير مكتملة داخل بيئة التشغيل.",
      };
      return apiSuccess(result, requestId, result.status === "healthy" ? 200 : 503);
    }
    const result = await testCurrentRuntimeFeature(body.feature);
    return apiSuccess(result, requestId, result.status === "healthy" ? 200 : 503);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/runtime-control");
  }
}
