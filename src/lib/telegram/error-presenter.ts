import { ApiError } from "@/lib/http/api";

const ERROR_MESSAGES: Record<string, string> = {
  AGENT_NOT_FOUND: "الوكيل غير موجود أو لم يعد متاحًا.",
  AGENT_DRAFT: "الوكيل ما زال مسودة ولا يمكن تشغيله.",
  AGENT_UNAVAILABLE: "الوكيل غير منشور أو غير متاح.",
  MODEL_UNAVAILABLE: "النموذج المحدد غير متاح لدى المزود.",
  PROVIDER_NOT_CONFIGURED: "لا يوجد مزود صالح مرتبط بالوكيل.",
  PROVIDER_UNAVAILABLE: "المزود غير متاح مؤقتًا.",
  TELEGRAM_CAPABILITY_DENIED: "هذه الميزة غير مفعلة أو لا تملك صلاحيتها.",
  TELEGRAM_REPOSITORIES_DENIED: "GitHub والمستودعات غير مفعلة أو لا تملك صلاحية قراءتها.",
  TELEGRAM_FILES_CAPABILITY_DENIED: "إرسال الملفات غير مفعّل لحسابك.",
  TELEGRAM_SESSION_NOT_FOUND: "جلسة Telegram غير موجودة. افتح القائمة وابدأ العملية مجددًا.",
  TELEGRAM_SESSION_CONFLICT: "تغيرت العملية من طلب آخر. أعد المحاولة من آخر خطوة.",
  TELEGRAM_FLOW_STALE: "انتهت صلاحية خيارات العملية. ابدأها مجددًا.",
  TELEGRAM_FLOW_INCOMPLETE: "بيانات العملية غير مكتملة ولم يتم حفظ أي نتيجة.",
  TELEGRAM_EMPTY_INPUT: "لا يمكن استخدام نص فارغ.",
  TELEGRAM_MEDIA_FEATURE_DENIED: "نوع الوسائط المرسل غير مفعّل لحسابك.",
  TELEGRAM_CHAT_FEATURE_DENIED: "ميزة الدردشة غير مفعلة لحسابك.",
  TELEGRAM_MEDIA_INVALID: "لم يتم العثور على وسيط صالح في الرسالة.",
  FILE_TOO_LARGE: "حجم الملف أكبر من الحد المسموح وهو 20 ميجابايت.",
  FILE_MIME_NOT_ALLOWED: "نوع الملف غير مدعوم.",
  FILE_SIGNATURE_INVALID: "محتوى الملف لا يطابق نوعه المعلن.",
  TELEGRAM_FILE_INVALID: "الملف المرسل غير صالح أو غير مدعوم.",
  TELEGRAM_FILE_DOWNLOAD_FAILED: "تعذر تنزيل الملف من Telegram مؤقتًا.",
  AGENT_TEAM_NOT_FOUND: "فريق الوكلاء غير موجود أو معطل.",
  TEAM_NOT_READY: "فريق الوكلاء غير جاهز للتشغيل. راجع المشرف والعاملين المنشورين.",
  TEAM_INPUT_INVALID: "مهمة الفريق مفقودة أو تتجاوز الحد المسموح.",
  TEAM_RUN_NOT_FOUND: "تشغيل الفريق غير موجود.",
  TEAM_RUN_NOT_CANCELLABLE: "لا يمكن إلغاء التشغيل في حالته الحالية.",
  TEAM_RUN_NOT_RETRYABLE: "لا يمكن إعادة التشغيل في حالته الحالية.",
  CONFIRMATION_REQUIRED: "يلزم تأكيد العملية قبل تنفيذها.",
  TOOL_APPROVAL_ALREADY_DECIDED: "اتُخذ قرار لهذه الموافقة مسبقًا.",
  RUN_LIMIT_REACHED: "تم الوصول إلى حد الاستخدام المسموح.",
  TOOL_APPROVAL_REQUIRED: "يلزم اعتماد موافقة قبل متابعة العملية.",
  GITHUB_NOT_CONFIGURED: "لا يوجد تكامل GitHub مفعّل ومتحقق لهذه المؤسسة.",
  GITHUB_TOKEN_INVALID: "اتصال GitHub لم يعد صالحًا. أعد التحقق منه من لوحة التكاملات.",
  GITHUB_API_ERROR: "تعذر الوصول إلى GitHub مؤقتًا.",
  GITHUB_REPOSITORY_NOT_FOUND: "المستودع لم يعد متاحًا للتكامل الحالي.",
  BROWSER_AUTH_HEALTH_FAILED: "فشل التحقق من اتصال Browser Runner والسر المشترك.",
  SANDBOX_AUTH_HEALTH_FAILED: "فشل التحقق من اتصال Sandbox Runner والسر المشترك.",
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
