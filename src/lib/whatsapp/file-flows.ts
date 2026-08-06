import { sendWhatsAppText } from "./message-renderer";
import type { WhatsAppRuntimeContext } from "./types";

export async function showWhatsAppFileInstructions(context: WhatsAppRuntimeContext) {
  await sendWhatsAppText({
    to: context.message.from,
    text: [
      "إرسال الملفات إلى منصة معتز",
      "أرسل ملفًا أو صورة أو تسجيلًا صوتيًا أو فيديو داخل الدردشة.",
      "سيتم التحقق من الصلاحية والحجم، ثم تنزيله من Meta وتخزينه عبر Storage Service وربطه بالمحادثة الفعلية.",
      "الحد الأقصى 20 ميجابايت. لا تُرسل رسالة نجاح قبل اكتمال التخزين.",
    ].join("\n"),
  });
}
