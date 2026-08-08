import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { whatsappConnections } from "@/db/schema";
import { auditPlatformOperation, requirePlatformPermission } from "@/lib/auth/platform-authorization";
import {
  ApiError,
  apiSuccess,
  assertSameOrigin,
  getRequestId,
  handleApiError,
  parseJson,
} from "@/lib/http/api";
import { sendTextMessage } from "@/lib/integrations/whatsapp/client";
import { initializeWhatsAppFromEnvironment } from "@/lib/platform/whatsapp-environment";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const operationSchema = z.object({
  action: z.enum(["refresh", "send_test"]),
}).strict();

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    await requirePlatformPermission("platform:read");
    const report = await initializeWhatsAppFromEnvironment();
    return apiSuccess(report, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/platform-admin/whatsapp-runtime");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requirePlatformPermission("platform:manage", { requireRecentReauthentication: true });
    await enforceRateLimit({
      scope: "platform.whatsapp-runtime:operation",
      key: `${session.userId}:${requestClientKey(request)}`,
      limit: 15,
      windowMs: 15 * 60_000,
    });
    const body = await parseJson(request, operationSchema, 4 * 1024);
    const report = await initializeWhatsAppFromEnvironment({ force: true });
    if (body.action === "refresh") {
      await auditPlatformOperation({
        actorUserId: session.userId,
        action: "platform.whatsapp_runtime.refreshed",
        resourceType: "whatsapp_runtime",
        requestId,
        metadata: { enabled: report.enabled, source: report.source },
      });
      return apiSuccess(report, requestId);
    }

    if (!session.organizationId) {
      throw new ApiError(409, "ORGANIZATION_REQUIRED", "اختر مؤسسة نشطة لإرسال رسالة اختبار إلى اتصال مستخدم.");
    }
    if (!report.enabled || report.health?.status !== "healthy") {
      throw new ApiError(
        503,
        "WHATSAPP_RUNTIME_NOT_HEALTHY",
        report.health?.details || "إعدادات WhatsApp في بيئة التشغيل غير مكتملة أو لم تجتز اختبار Meta.",
      );
    }
    const [connection] = await db().select({
      id: whatsappConnections.id,
      waId: whatsappConnections.whatsappWaId,
      phoneNumberMasked: whatsappConnections.whatsappPhoneNumberMasked,
    }).from(whatsappConnections).where(and(
      eq(whatsappConnections.userId, session.userId),
      eq(whatsappConnections.organizationId, session.organizationId),
      eq(whatsappConnections.connectionStatus, "connected"),
    )).limit(1);
    if (!connection?.waId) {
      throw new ApiError(
        409,
        "WHATSAPP_TEST_RECIPIENT_NOT_CONNECTED",
        "اربط حساب WhatsApp الخاص بك أولًا عبر بطاقة الاتصال، ثم أعد إرسال الرسالة الاختبارية.",
      );
    }

    const sent = await sendTextMessage({
      to: connection.waId,
      text: `اختبار منصة معتز AI ناجح ✅\nالوقت: ${new Date().toISOString()}\nRequest ID: ${requestId}`,
    });
    await auditPlatformOperation({
      actorUserId: session.userId,
      action: "platform.whatsapp_runtime.test_message_sent",
      resourceType: "whatsapp_connection",
      resourceId: connection.id,
      requestId,
      metadata: { messageId: sent.messageId, recipient: connection.phoneNumberMasked },
    });
    return apiSuccess({ report, messageId: sent.messageId, recipient: connection.phoneNumberMasked }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/platform-admin/whatsapp-runtime");
  }
}
