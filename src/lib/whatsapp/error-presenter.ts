import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/http/api";

const MESSAGES: Record<string, string> = {
  AGENT_NOT_FOUND: "الوكيل غير موجود.",
  AGENT_UNAVAILABLE: "الوكيل غير منشور أو غير جاهز للاستخدام.",
  CHANNEL_AGENT_REQUIRED: "لا يوجد وكيل صالح مرتبط بالمحادثة. اختر وكيلًا منشورًا أولًا.",
  CHANNEL_AGENT_UNAVAILABLE: "الوكيل المختار غير منشور أو لم يعد متاحًا.",
  PROVIDER_UNAVAILABLE: "لا يوجد مزود ذكاء اصطناعي متحقق ومفعل.",
  CHANNEL_PROVIDER_UNAVAILABLE: "المزود المرتبط بالوكيل معطل أو غير متحقق.",
  MODEL_UNAVAILABLE: "النموذج غير متاح لدى المزود المحدد.",
  CHANNEL_MODEL_UNAVAILABLE: "النموذج المرتبط بالمحادثة لم يعد متاحًا.",
  FORBIDDEN: "لا تملك الصلاحية اللازمة لهذا الإجراء.",
  WHATSAPP_FEATURE_FORBIDDEN: "هذه الميزة غير مفعلة لك على WhatsApp.",
  WHATSAPP_MODULE_DISABLED: "الوحدة المطلوبة معطلة في المؤسسة.",
  CHANNEL_MONTHLY_LIMIT_REACHED: "تم الوصول إلى الحد الشهري المسموح للقناة.",
  WHATSAPP_MEDIA_TOO_LARGE: "حجم الملف يتجاوز الحد المسموح وهو 20 ميجابايت.",
  CHANNEL_MEDIA_UNSUPPORTED: "نوع الملف أو الوسائط غير مدعوم في هذه القناة.",
  WHATSAPP_SESSION_EXPIRED: "انتهت صلاحية العملية. ابدأها من القائمة مرة أخرى.",
  WHATSAPP_SESSION_CONFLICT: "تغيرت حالة العملية. أعد فتح القائمة ثم حاول مرة أخرى.",
  WHATSAPP_CONFIRMATION_REQUIRED: "يلزم تأكيد صريح قبل تنفيذ هذا الإجراء.",
  TOOL_APPROVAL_REQUIRED: "تتطلب الأداة موافقة قبل التنفيذ.",
  DATABASE_UNAVAILABLE: "قاعدة البيانات غير متاحة مؤقتًا.",
  WHATSAPP_API_TIMEOUT: "انتهت مهلة الاتصال بخدمة WhatsApp. حاول لاحقًا.",
  WHATSAPP_API_NETWORK_ERROR: "تعذر الاتصال بخدمة WhatsApp مؤقتًا.",
  WHATSAPP_API_UNAVAILABLE: "خدمة WhatsApp غير متاحة مؤقتًا.",
  WHATSAPP_RATE_LIMITED: "بلغ WhatsApp حد الطلبات مؤقتًا. حاول بعد قليل.",
};

export function whatsappErrorPresentation(error: unknown) {
  const referenceId = randomUUID();
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: MESSAGES[error.code] ?? error.message,
      referenceId,
      expected: true,
    };
  }
  const code = error instanceof Error && /^[A-Z0-9_.:-]{1,120}$/.test(error.message)
    ? error.message
    : error instanceof Error ? error.name.slice(0, 120) : "WHATSAPP_PROCESSING_FAILED";
  return {
    code,
    message: MESSAGES[code] ?? "حدث خطأ غير متوقع أثناء تنفيذ الطلب.",
    referenceId,
    expected: false,
  };
}
