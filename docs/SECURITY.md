# الأمان

## الأسرار

- AES-256-GCM مع nonce عشوائي 96-bit وauthentication tag وenvelope يبدأ بـ`v1`.
- المفتاح الرئيسي يأتي من `CREDENTIAL_ENCRYPTION_KEY` فقط.
- المفتاح الأصلي لا يعود في API؛ الواجهة ترى hint محدودًا.
- لا تحتوي سجلات التدقيق أو run events على provider keys أو Cookies أو system prompts.

## SSRF واتصالات المزود

- HTTPS إلزامي في الإنتاج.
- رفض username/password داخل URL والمنافذ غير المسموحة.
- رفض localhost وprivate/link-local/loopback/metadata وIPv6 local.
- DNS resolution قبل كل اتصال ورفض أي نتيجة داخلية.
- `redirect: error`، timeout، وحدود لحجم JSON والبث.
- Gemini يستخدم `x-goog-api-key` بدل query string.
- retry لا يعمل لأخطاء 401/403/404/422؛ يعمل بصورة محدودة للأخطاء المؤقتة.

## الويب

- Origin/CSRF checks لطلبات Cookie التي تغير الحالة.
- Cookies آمنة، CSP، `frame-ancestors 'none'`, `nosniff`, referrer policy وHSTS في الإنتاج.
- لا يستخدم `dangerouslySetInnerHTML` لمحتوى المحادثات.
- الصفحات الحساسة وAPI responses تستخدم `no-store`.
- كل response خطأ يحمل request ID ولا يعرض stack trace.

## العزل المؤسسي

- المؤسسة تأتي من الجلسة أو platform API key.
- كل query لمورد مؤسسي يقيد `organizationId` أو يتحقق من parent المقيد.
- عمليات GET لا تعتمد على إخفاء الواجهة؛ الصلاحيات مفروضة في Route Handler أو Server Component.
- حذف مزود يتحقق من ارتباطه بإصدارات الوكلاء.

## الاستجابة للحوادث

1. عطّل المزود المتأثر.
2. دوّر مفتاح المزود عبر واجهة التعديل.
3. افحص audit log وruns باستخدام request IDs.
4. عند الاشتباه بمفتاح التشفير، أوقف الكتابة، أعد تشفير الأسرار بمفتاح جديد ثم دوّر متغير البيئة.
5. غيّر كلمة المرور لإبطال كل الجلسات.
