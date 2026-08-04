import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, whatsappConnections } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import {
  apiSuccess,
  assertSameOrigin,
  getRequestId,
  handleApiError,
  parseJson,
} from "@/lib/http/api";
import { sendTextMessage } from "@/lib/integrations/whatsapp/client";
import { ApiError } from "@/lib/http/api";
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
    await requireSession("organization:manage");
    const report = await initializeWhatsAppFromEnvironment();
    return apiSuccess(report, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/whatsapp-runtime");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("organization:manage");
    await enforceRateLimit({
      scope: "whatsapp-runtime:operation",
      key: `${session.organizationId}:${session.userId}:${requestClientKey(request)}`,
      limit: 15,
      windowMs: 15 * 60_000,
    });
    const body = await parseJson(request, operationSchema, 4 * 1024);
    const report = await initializeWhatsAppFromEnvironment({ force: true });
    if (body.action === "refresh") return apiSuccess(report, requestId);

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
    await db().insert(auditLogs).values({
      organizationId: session.organizationId,
      actorType: "user",
      actorId: session.userId,
      action: "whatsapp.runtime_test_message_sent",
      resourceType: "whatsapp_connection",
      resourceId: connection.id,
      metadata: {
        requestId,
        messageId: sent.messageId,
        recipient: connection.phoneNumberMasked,
      },
    });
    return apiSuccess({ report, messageId: sent.messageId, recipient: connection.phoneNumberMasked }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/whatsapp-runtime");
  }
}
