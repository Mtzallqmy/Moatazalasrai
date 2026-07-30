export type PlatformErrorDescriptor = {
  status: number;
  retryable: boolean;
  messageAr: string;
  messageEn: string;
  actionAr: string;
  actionEn: string;
};

export const platformErrors = {
  NO_ACTIVE_AGENT: { status: 409, retryable: false, messageAr: "لا يوجد وكيل نشط.", messageEn: "No active agent is configured.", actionAr: "اختر وكيلًا منشورًا.", actionEn: "Select a published agent." },
  AGENT_UNAVAILABLE: { status: 422, retryable: false, messageAr: "الوكيل غير منشور أو غير متاح.", messageEn: "The agent is unpublished or unavailable.", actionAr: "انشر الوكيل أو اختر وكيلًا آخر.", actionEn: "Publish the agent or select another." },
  PROVIDER_UNAVAILABLE: { status: 422, retryable: false, messageAr: "المزود غير مهيأ أو غير متحقق.", messageEn: "The provider is missing or unverified.", actionAr: "افحص المزود والنموذج من لوحة المزودات.", actionEn: "Validate the provider and model." },
  PROVIDER_OR_MODEL_UNAVAILABLE: { status: 422, retryable: false, messageAr: "لا يوجد مزود أو نموذج صالح للتشغيل.", messageEn: "No usable provider or model is available.", actionAr: "فعّل مزودًا متحققًا أو انتظر انتهاء فترة الحظر.", actionEn: "Enable a verified provider or wait for its circuit to close." },
  MODEL_NOT_AVAILABLE: { status: 422, retryable: false, messageAr: "النموذج المحدد غير متاح.", messageEn: "The selected model is unavailable.", actionAr: "زامن النماذج واختر نموذجًا متاحًا.", actionEn: "Sync models and select an available model." },
  PROVIDER_UNAUTHORIZED: { status: 422, retryable: false, messageAr: "رفض المزود بيانات الاعتماد.", messageEn: "The provider rejected the credentials.", actionAr: "حدّث المفتاح ثم أعد الفحص.", actionEn: "Update the key and validate again." },
  PROVIDER_PAYMENT_REQUIRED: { status: 402, retryable: false, messageAr: "رصيد المزود أو المفتاح غير كافٍ.", messageEn: "The provider account or API key has insufficient credits.", actionAr: "أضف رصيدًا لدى المزود أو اختر اتصالًا آخر.", actionEn: "Add provider credits or select another connection." },
  PROVIDER_FORBIDDEN: { status: 422, retryable: false, messageAr: "المفتاح لا يملك الصلاحية المطلوبة أو حظر المزود الطلب.", messageEn: "The key lacks permission or the provider blocked the request.", actionAr: "راجع صلاحيات المفتاح وسياسات المزود ثم أعد الفحص.", actionEn: "Review key permissions and provider policy, then validate again." },
  PROVIDER_ENDPOINT_NOT_FOUND: { status: 422, retryable: false, messageAr: "المسار أو النموذج غير موجود لدى المزود.", messageEn: "The provider endpoint or model was not found.", actionAr: "زامن قائمة النماذج أو صحح Base URL.", actionEn: "Sync models or correct the base URL." },
  PROVIDER_REJECTED_INPUT: { status: 422, retryable: false, messageAr: "رفض المزود إعدادات الطلب.", messageEn: "The provider rejected the request parameters.", actionAr: "اختر نموذجًا آخر أو قلل السياق والمرفقات.", actionEn: "Choose another model or reduce context and attachments." },
  PROVIDER_RATE_LIMITED: { status: 429, retryable: true, messageAr: "بلغ المزود حد الطلبات.", messageEn: "The provider rate limit was reached.", actionAr: "انتظر قليلًا ثم أعد المحاولة.", actionEn: "Wait briefly and retry." },
  PROVIDER_TIMEOUT: { status: 504, retryable: true, messageAr: "انتهت مهلة استجابة المزود.", messageEn: "The provider request timed out.", actionAr: "أعد المحاولة أو اختر مزودًا آخر.", actionEn: "Retry or select another provider." },
  PROVIDER_UNAVAILABLE_TEMPORARY: { status: 503, retryable: true, messageAr: "المزود غير متاح مؤقتًا.", messageEn: "The provider is temporarily unavailable.", actionAr: "أعد المحاولة بعد قليل.", actionEn: "Retry shortly." },
  CONTEXT_TOO_LARGE: { status: 422, retryable: false, messageAr: "السياق أكبر من حد النموذج.", messageEn: "The context exceeds the model limit.", actionAr: "ابدأ محادثة جديدة أو قلل المرفقات.", actionEn: "Start a new conversation or reduce attachments." },
  DATABASE_ERROR: { status: 503, retryable: true, messageAr: "قاعدة البيانات غير متاحة مؤقتًا.", messageEn: "The database is temporarily unavailable.", actionAr: "أعد المحاولة واستخدم requestId للدعم.", actionEn: "Retry and provide requestId to support." },
  NETWORK_ERROR: { status: 503, retryable: true, messageAr: "تعذر الوصول إلى الخدمة الخارجية.", messageEn: "The external service could not be reached.", actionAr: "تحقق من الاتصال ثم أعد المحاولة.", actionEn: "Check connectivity and retry." },
  PROVIDER_CANCELLED: { status: 409, retryable: false, messageAr: "تم إيقاف التشغيل.", messageEn: "The run was cancelled.", actionAr: "يمكنك إرسال الطلب مجددًا.", actionEn: "You may send the request again." },
  INTERNAL_ERROR: { status: 500, retryable: false, messageAr: "حدث خطأ داخلي آمن.", messageEn: "An internal error occurred.", actionAr: "انسخ requestId للدعم.", actionEn: "Copy requestId for support." },
} as const satisfies Record<string, PlatformErrorDescriptor>;

export function errorDescriptor(code: string): PlatformErrorDescriptor | undefined {
  return platformErrors[code as keyof typeof platformErrors];
}
