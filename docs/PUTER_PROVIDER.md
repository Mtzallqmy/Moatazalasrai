# مزوّد Puter الاختياري

## النطاق المعماري

Puter مزوّد `client-managed` يعمل من المتصفح، منفصل عن مزوّدات BYOK الخادمية. لا يُضاف إلى `provider_credentials` ولا إلى Factory الخاص بـVercel AI SDK، ولا ينفذ من API Route أو Server Action أو Graphile Worker.

الإصدار الأول يدعم:

- اتصال المستخدم عبر واجهة Puter الرسمية.
- اكتشاف النماذج ديناميكيًا عبر `puter.ai.listModels()` مع cache لمدة 15 دقيقة.
- دردشة نصية streaming عبر `puter.ai.chat(..., { stream: true })`.
- حفظ رسائل المستخدم والرد النهائي في المحادثة الحالية بعد فحص الجلسة والمؤسسة والملكية.

## قيد runs والوكلاء

مخطط `runs` الحالي يفرض مزودًا خادميًا ونسخة وكيل مرتبطة بـ`provider_credentials`. لتجنب migration أو تغيير عقود التشغيل، لا ينشئ Puter server run في هذا الإصدار ولا يمكن اختياره عند إنشاء وكيل منشور. الحفظ يستخدم metadata الرسائل الحالية فقط:

- `provider: "puter"`
- `executionSource: "client"`
- `clientExecutionId`

لا يدعم Puter حاليًا Worker أو Telegram أو API v1 أو agent teams أو MCP/RAG/tools الخادمية أو التشغيل المجدول.

## التفعيل والتراجع

```env
NEXT_PUBLIC_PUTER_ENABLED=true
```

القيمة الافتراضية `false`. تعطيل المتغير يخفي البطاقة ومسار الدردشة ولا يحمّل SDK، بينما تبقى الرسائل المحفوظة قابلة للقراءة مثل أي رسالة نصية.

## الخصوصية

يظهر تنبيه قبل أول استخدام. لا يرسل الخادم طلب AI إلى Puter، ولا يستقبل أو يخزن Puter auth token. ناتج العميل يُحفظ على أنه محتوى غير موثوق (`untrustedClientOutput: true`) ولا يُستخدم كإثبات مالي أو أمني.

## CSP

عند التفعيل، يضاف فقط `https://api.puter.com` و`wss://api.puter.com` إلى `connect-src`. تسجيل الدخول يفتح نافذة رسمية على `https://puter.com` ولا يحتاج إلى `unsafe-inline` أو `unsafe-eval` أو wildcard.
