import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/http/api";

const KNOWN_MESSAGES: Record<string, string> = {
  AGENT_NOT_FOUND: "الوكيل غير موجود أو لم يعد متاحًا لحسابك.",
  AGENT_DRAFT: "الوكيل ما زال مسودة. انشره من لوحة التحكم أو اختر وكيلًا منشورًا.",
  AGENT_ARCHIVED: "الوكيل مؤرشف ولا يمكن تشغيله.",
  AGENT_PROVIDER_MISSING: "لا يوجد مزود صالح مرتبط بالوكيل.",
  AGENT_PROVIDER_DISABLED: "مزود الوكيل معطل حاليًا.",
  AGENT_PROVIDER_UNVERIFIED: "مزود الوكيل لم يجتز التحقق.",
  AGENT_MODEL_UNAVAILABLE: "النموذج المحدد للوكيل غير متاح لدى المزود.",
  MODEL_UNAVAILABLE: "النموذج المحدد غير متاح لدى المزود.",
  FORBIDDEN: "لا تملك الصلاحية اللازمة لهذا الإجراء.",
  ORGANIZATION_MEMBERSHIP_REQUIRED: "لم يعد حسابك عضوًا في المؤسسة المحددة.",
  CHANNEL_SESSION_CONFLICT: "تغيرت الجلسة أثناء التنفيذ. أعد المحاولة.",
  CHANNEL_AGENT_REQUIRED: "اختر وكيلًا صالحًا قبل بدء المحادثة.",
  CHANNEL_AGENT_UNAVAILABLE: "الوكيل المحدد غير منشور أو غير متاح.",
  CHANNEL_PROVIDER_UNAVAILABLE: "مزود الذكاء الاصطناعي غير متصل أو غير متحقق.",
  CHANNEL_MODEL_UNAVAILABLE: "النموذج غير متاح لدى المزود المحدد.",
  CHANNEL_MONTHLY_LIMIT_REACHED: "تم الوصول إلى حد الاستخدام الشهري للقناة.",
  FILE_TOO_LARGE: "الملف أكبر من الحجم المسموح.",
  CHANNEL_MEDIA_UNSUPPORTED: "نوع الملف أو الوسائط غير مدعوم في هذه القناة.",
  CHANNEL_FILES_FORBIDDEN: "استخدام الملفات غير مسموح لحسابك في هذه القناة.",
  PROVIDER_PAYMENT_REQUIRED: "رصيد المزود غير كافٍ لإكمال الطلب.",
  PROVIDER_UNAUTHORIZED: "بيانات اعتماد المزود غير صالحة.",
  PROVIDER_MODEL_UNAVAILABLE: "النموذج المطلوب غير متاح لدى المزود.",
  TOOL_APPROVAL_REQUIRED: "تحتاج العملية إلى موافقة قبل تنفيذ الأداة.",
};

export function presentChannelClientError(error: unknown) {
  const referenceId = randomUUID().slice(0, 8);
  if (error instanceof ApiError) {
    return {
      code: error.code,
      referenceId,
      message: KNOWN_MESSAGES[error.code] ?? error.message ?? `تعذر إكمال الطلب. المرجع: ${referenceId}`,
    };
  }
  const code = error instanceof Error && /^[A-Z0-9_.:-]{1,120}$/.test(error.message)
    ? error.message
    : error instanceof Error ? error.name : "CHANNEL_CLIENT_FAILED";
  return {
    code,
    referenceId,
    message: KNOWN_MESSAGES[code] ?? `تعذر إكمال الطلب حاليًا. المرجع: ${referenceId}`,
  };
}
