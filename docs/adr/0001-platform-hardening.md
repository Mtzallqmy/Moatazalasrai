# ADR 0001: تقوية المنصة دون كسر العقود

- الحالة: مقبول — 2026-08-01.
- القرار: إبقاء التفويض في التطبيق كمصدر إلزامي، واستخدام قيود PostgreSQL كدفاع إضافي لا بديل. migrations additive وتسبق web/worker.
- الأسرار: envelope v2 مع key ID وAAD؛ قراءة v1 تبقى مؤقتًا، والتدوير مرحلتان بأداة idempotent وسجل تدقيق.
- الجلسات: absolute 30 يومًا، idle 7 أيام، وتدوير عند تبديل المؤسسة. Refresh الهاتف compare-and-swap.
- الشبكة: deny-by-default للعناوين الخاصة وredirects، مع تسجيل DNS pinning كعمل معماري لاحق يحتاج دعم transport موحد.
- الواجهة: nonce CSP بدل inline scripts غير المقيدة؛ بقي inline styles للمقايضة مع stack الحالي.
- CI: Node 22.18.0 موحد، Actions مثبتة SHA، وإصدار Android يفشل دون keystore إنتاجي.

البدائل المرفوضة: RLS الفوري قبل اختبار Worker/admin، migration مدمرة، fallback مزود صامت يغير الخصوصية/التكلفة، أو توقيع debug لإصدار منشور.

