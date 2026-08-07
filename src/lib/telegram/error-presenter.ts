import { ApiError } from "@/lib/http/api";

const ERROR_MESSAGES: Record<string, string> = {
  AGENT_NOT_FOUND: "الوكيل غير موجود أو لم يعد متاحًا.",
  AGENT_DRAFT: "الوكيل ما زال مسودة ولا يمكن تشغيله.",
  AGENT_UNAVAILABLE: "الوكيل غير منشور أو غير متاح.",
  MODEL_UNAVAILABLE: "النموذج المحدد غير متاح لدى المزود.",
  PROVIDER_NOT_CONFIGURED: "لا يوجد مزود صالح مرتبط بالوكيل.",
  PROVIDER_UNAVAILABLE: "المزود غير متاح مؤقتًا.",
  TELEGRAM_CAPABILITY_DENIED: "هذه الميزة غير مفعلة أو لا تملك صلاحيتها.",
  TELEGRAM_SESSION_NOT_FOUND: "جلسة Telegram غير موجودة. افتح القائمة وابدأ العملية مجددًا.",
  TELEGRAM_SESSION_CONFLICT: "تغيرت العملية من طلب آخر. أعد المحاولة من آخر خطوة.",
  TELEGRAM_FLOW_STALE: "انتهت صلاحية خيارات العملية. ابدأها مجددًا.",
  TELEGRAM_FLOW_INCOMPLETE: "بيانات العملية غير مكتملة ولم يتم حفظ أي نتيجة.",
  TELEGRAM_EMPTY_INPUT: "لا يمكن استخدام نص فارغ.",
  FILE_TOO_LARGE: "حجم الملف أكبر من الحد المسموح.",
  TELEGRAM_FILE_INVALID: "الملف المرسل غير صالح أو غير مدعوم.",
  RUN_LIMIT_REACHED: "تم الوصول إلى حد الاستخدام المسموح.",
  TOOL_APPROVAL_REQUIRED: "يلزم اعتماد موافقة قبل متابعة العملية.",
  DATABASE_UNAVAILABLE: "قاعدة البيانات غير متاحة مؤقتًا.",
  TELEGRAM_API_ERROR: "خدمة Telegram غير متاحة مؤقتًا.",
};

export function presentTelegramError(error: unknown, referenceId: string) {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: ERROR_MESSAGES[error.code] ?? error.message,
      referenceId,
    };
  }
  const code = error instanceof Error ? error.name.slice(0, 80) : "TELEGRAM_UNEXPECTED_ERROR";
  return {
    code,
    message: "تعذر إكمال الطلب بسبب خطأ غير متوقع. حاول مجددًا لاحقًا.",
    referenceId,
  };
}
