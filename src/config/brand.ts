export const brand = {
  nameAr: "معتز AI",
  developer: "معتز العلقمي",
  copyrightYear: "2026 م",
} as const;

/**
 * ضع الرابط الكامل فقط داخل href. إبقاؤه فارغًا يعرض الأيقونة بحالة
 * غير نشطة، ولا ينقل الزائر إلى رابط ناقص أو وهمي.
 */
export const socialLinks = [
  { id: "whatsapp", label: "واتساب", href: "" },
  { id: "telegram", label: "تليجرام", href: "" },
  { id: "facebook", label: "فيسبوك", href: "" },
  { id: "x", label: "X", href: "" },
  { id: "instagram", label: "إنستغرام", href: "" },
] as const;
