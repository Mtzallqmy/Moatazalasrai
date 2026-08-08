import { z } from "zod";
import { auditPlatformOperation, requirePlatformPermission } from "@/lib/auth/platform-authorization";
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
import { assertRunnerConnection, testCurrentAuthenticatedRunner } from "@/lib/platform/runner-auth-health";
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
    await requirePlatformPermission("platform:read");
    await initializeWhatsAppFromEnvironment();
    const snapshot = await hydrateRuntimeControlPlane(true);
    return apiSuccess(snapshot, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/platform-admin/runtime-control");
  }
}

export async function PUT(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requirePlatformPermission("platform:manage", { requireRecentReauthentication: true });
    await enforceRateLimit({
      scope: "platform.runtime-control:update",
      key: `${session.userId}:${requestClientKey(request)}`,
      limit: 12,
      windowMs: 15 * 60_000,
    });
    const body = await parseJson(request, runtimeControlUpdateSchema, 48 * 1024);
    if (body.feature === "whatsapp" && inspectWhatsAppEnvironment().authoritative) {
      throw new ApiError(
        409,
        "WHATSAPP_ENVIRONMENT_MANAGED",
        "إعدادات WhatsApp تُدار تلقائيًا من Environment Variables ولا يمكن استبدالها من الواجهة.",
      );
    }
    if ((body.feature === "sandbox" || body.feature === "browser") && body.enabled && body.runnerUrl && body.sharedSecret) {
      await assertRunnerConnection({ feature: body.feature, runnerUrl: body.runnerUrl, sharedSecret: body.sharedSecret });
    }
    const snapshot = await saveRuntimeControl(body, session.userId);
    await auditPlatformOperation({
      actorUserId: session.userId,
      action: "platform.runtime_control.updated",
      resourceType: "platform_runtime_settings",
      resourceId: body.feature,
      requestId,
      metadata: { feature: body.feature, enabled: body.enabled },
    });
    return apiSuccess(snapshot, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/platform-admin/runtime-control");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requirePlatformPermission("platform:manage");
    await enforceRateLimit({
      scope: "platform.runtime-control:test",
      key: session.userId,
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
    const result = body.feature === "sandbox" || body.feature === "browser"
      ? await testCurrentAuthenticatedRunner(body.feature)
      : await testCurrentRuntimeFeature(body.feature);
    await auditPlatformOperation({
      actorUserId: session.userId,
      action: "platform.runtime_control.tested",
      resourceType: "platform_runtime_settings",
      resourceId: body.feature,
      requestId,
      metadata: { status: result.status },
    });
    return apiSuccess(result, requestId, result.status === "healthy" ? 200 : 503);
  } catch (error) {
    return handleApiError(error, requestId, "/api/platform-admin/runtime-control");
  }
}
