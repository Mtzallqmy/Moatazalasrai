import { ApiError } from "@/lib/http/api";

const messages: Record<string, string> = {
  AGENT_NOT_FOUND: "الوكيل المطلوب غير موجود أو لم يعد متاحًا لحسابك.",
  AGENT_UNAVAILABLE: "الوكيل غير متاح أو غير منشور.",
  AGENT_DRAFT: "الوكيل ما زال مسودة. انشره من لوحة الموقع قبل تشغيله.",
  AGENT_VERSION_MISSING: "إصدار الوكيل الحالي غير مكتمل.",
  PROVIDER_UNAVAILABLE: "لا يوجد مزود صالح ومتحقق لتشغيل هذه العملية.",
  PROVIDER_OR_MODEL_UNAVAILABLE: "لا يوجد مزود متحقق ونموذج مناسب لتشغيل الوكيل.",
  MODEL_UNAVAILABLE: "النموذج المحدد غير متاح لدى المزود الحالي.",
  TOOL_CALLING_MODEL_REQUIRED: "الوكيل يستخدم أدوات، ولا يوجد نموذج متحقق يدعم استدعاء الأدوات.",
  FORBIDDEN: "لا تملك الصلاحية المطلوبة لهذا الإجراء.",
  TELEGRAM_FEATURE_FORBIDDEN: "ميزة Telegram المطلوبة غير مفعلة لحسابك.",
  PLATFORM_MODULE_DISABLED: "وحدة المنصة المطلوبة غير مفعلة في مؤسستك.",
  CHANNEL_MONTHLY_LIMIT_REACHED: "تم الوصول إلى الحد الشهري المسموح.",
  FILE_TOO_LARGE: "حجم الملف يتجاوز الحد المسموح.",
  PAYLOAD_TOO_LARGE: "حجم الطلب يتجاوز الحد المسموح.",
  FILE_TYPE_UNSUPPORTED: "نوع الملف غير مدعوم حاليًا.",
  FILE_CONTENT_UNAVAILABLE: "تم تخزين الملف، لكن لا يوجد محتوى قابل للمعالجة بواسطة الوكيل.",
  TELEGRAM_FLOW_EXPIRED: "انتهت صلاحية العملية الحالية. ابدأها من جديد من القائمة.",
  TELEGRAM_FLOW_MISSING: "لا توجد عملية نشطة يمكن متابعتها.",
  TELEGRAM_SESSION_CONFLICT: "تغيرت الجلسة أثناء المعالجة. افتح القائمة وأعد المحاولة.",
  TELEGRAM_SESSION_MISSING: "تعذر العثور على جلسة Telegram صالحة.",
  CONFIRMATION_REQUIRED: "يلزم تأكيد الإجراء قبل تنفيذه.",
  TOOL_APPROVAL_NOT_FOUND: "طلب الموافقة غير موجود.",
  TOOL_APPROVAL_ALREADY_DECIDED: "تمت معالجة طلب الموافقة مسبقًا.",
  TOOL_APPROVAL_EXPIRED: "انتهت صلاحية طلب الموافقة.",
  DATABASE_UNAVAILABLE: "قاعدة البيانات غير متاحة مؤقتًا. حاول لاحقًا.",
  TELEGRAM_API_ERROR: "خدمة Telegram غير متاحة مؤقتًا. حاول لاحقًا.",
  PROVIDER_UNAUTHORIZED: "بيانات اعتماد المزود غير صالحة. راجع إعدادات المزود في الموقع.",
  PROVIDER_RATE_LIMITED: "مزود الذكاء الاصطناعي رفض الطلب بسبب حد الاستخدام. حاول لاحقًا.",
  PROVIDER_EMPTY_OUTPUT: "لم يُرجع المزود محتوى صالحًا.",
  EMPTY_MESSAGE: "لا يمكن إرسال رسالة فارغة.",
  ORGANIZATION_MEMBERSHIP_REQUIRED: "لم تعد عضوًا في المؤسسة المحددة.",
  CONVERSATION_NOT_FOUND: "المحادثة غير موجودة أو لا تملك حق الوصول إليها.",
};

function safeReference() {
  return crypto.randomUUID().split("-")[0]!.toUpperCase();
}

export function presentTelegramError(error: unknown) {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      text: messages[error.code] ?? error.message ?? "تعذر إكمال العملية.",
      referenceId: undefined,
    };
  }
  const code = error instanceof Error && /^[A-Z0-9_.:-]{2,120}$/.test(error.message)
    ? error.message
    : "TELEGRAM_UNEXPECTED_ERROR";
  return {
    code,
    text: "حدث خطأ غير متوقع أثناء تنفيذ العملية.",
    referenceId: safeReference(),
  };
}
