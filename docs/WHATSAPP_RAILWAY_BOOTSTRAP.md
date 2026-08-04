# WhatsApp Cloud API — Railway Environment Bootstrap

<!-- يوضح هذا المستند مصدر الإعدادات، دورة التهيئة، والتشخيص الآمن دون نسخ أسرار الإنتاج. -->

## مصدر الحقيقة

عند وجود أي متغير خاص بـMeta أو WhatsApp من المجموعة المعتمدة، تصبح Environment Variables داخل عملية Railway هي المصدر الأعلى أولوية. لا يعتمد التفعيل على إدخال يدوي داخل لوحة الإدارة، ولا يحتاج إلى `WHATSAPP_INTEGRATION_ENABLED`؛ تنشئ خدمة التهيئة هذا العلم داخل العملية بعد اجتياز اختبار Meta.

المتغيرات المطلوبة:

- `META_APP_ID`
- `META_APP_SECRET`
- `META_GRAPH_API_VERSION`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_DISPLAY_PHONE_NUMBER`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_CONNECT_TOKEN_SECRET`
- `APP_URL`
- `PUBLIC_APP_URL`

وجود `APP_URL` أو `PUBLIC_APP_URL` وحدهما لا يحوّل WhatsApp إلى وضع Railway-managed، لأنهما متغيران عامان للمنصة.

## دورة Startup

1. يقرأ Web وGraphile Worker القيم من `process.env`.
2. يتحقق من الأسماء، الأطوال، المعرفات الرقمية، إصدار Graph API، وروابط HTTPS في Production.
3. يختبر `/{version}/{phone-number-id}` باستخدام System User access token.
4. يفحص `/{version}/{waba-id}/subscribed_apps` للتأكد من اشتراك App ID في WABA Webhooks.
5. يفعّل WhatsApp داخل العملية عند نجاح اختبار Phone Number ID.
6. يحفظ أو يحدّث نسخة مشفرة بـAES-256-GCM في `platform_runtime_settings` لأغراض الاستمرارية والتدقيق.
7. يسجل نتيجة آمنة لا تحتوي Access Token أو App Secret.

إذا تغيرت Environment Variables، فإن Railway يعيد تشغيل الخدمة عند Redeploy، وتحدّث التهيئة الصف الحالي بدل إنشاء صف مكرر (`id = primary`).

## لوحة الإدارة

تظهر الحالة في `/dashboard/settings` للأدوار الإدارية، وتشمل:

- حالة قراءة كل متغير من عملية Node الفعلية.
- القيم العامة والقيم السرية المقنعة.
- بيئة Railway المرصودة.
- نتيجة Meta Graph API وتصنيف الخطأ و`code/subcode/fbtrace_id` الآمنة.
- Phone Number ID والاسم الموثق وQuality Rating.
- حالة اشتراك التطبيق في WABA والـWebhook URL المتوقع.
- زر إعادة قراءة البيئة واختبار Meta.
- زر إرسال رسالة اختبار إلى حساب WhatsApp المرتبط بالمستخدم الإداري.

عند كون Railway مصدر الحقيقة، ترفض API محاولات استبدال إعدادات WhatsApp من مركز التحكم اليدوي بالخطأ `WHATSAPP_ENVIRONMENT_MANAGED`.

## تشخيص الأعطال

- `invalid_token`: Access Token منتهي، ملغى، أو لا يخص Business الصحيح.
- `missing_scope`: غالبًا غياب `whatsapp_business_management` أو `whatsapp_business_messaging`.
- `permission`: System User غير مسند إلى WABA/Phone Number أو لا يملك المهمة المطلوبة.
- `wrong_phone_number_id`: تم استخدام رقم الهاتف أو WABA ID بدل Phone Number ID.
- `rate_limit`: حد Meta مؤقت؛ انتظر ثم أعد الاختبار.
- `network_error`: فشل DNS/egress أو timeout من Railway.
- `not_subscribed`: App ID غير موجود ضمن `subscribed_apps` للـWABA.

عند ظهور متغير غير مقروء رغم وجوده في Railway Dashboard، راجع بالترتيب:

1. المتغير موجود في خدمة Web وWorker الصحيحتين، لا في خدمة أخرى.
2. المتغير موجود في Environment النشطة نفسها (Production مقابل Development/Preview).
3. الاسم مطابق حرفيًا، مع مراجعة الاسم البديل الذي تعرضه لوحة التشخيص إن وُجد.
4. تم تنفيذ Redeploy بعد تعديل القيم.
5. لا توجد قيمة فارغة أو مسافات فقط.
6. سجلات Startup تحتوي حدث `whatsapp.environment.initialized` أو `whatsapp.environment.initialization_failed`.

## Webhook وConnect

Webhook العام هو:

```text
${PUBLIC_APP_URL}/api/webhooks/whatsapp
```

يتحقق مسار GET من `WHATSAPP_WEBHOOK_VERIFY_TOKEN`، ويتحقق POST من توقيع `X-Hub-Signature-256` باستخدام `META_APP_SECRET`. ميزة Connect تصدر token أحادي الاستخدام ومحدد العمر، وتربط `wa_id` بالمستخدم بعد وصول رسالة `CONNECT <token>` الموقعة من Meta.

## الاختبار الحي

بعد النشر:

1. افتح إعدادات المنصة وتأكد أن 11/11 متغيرًا محمّل.
2. نفّذ «إعادة قراءة البيئة واختبار Meta».
3. تأكد من `Meta متصل` ومن أن WABA subscribed.
4. استخدم بطاقة WhatsApp لربط حسابك عبر رسالة CONNECT.
5. نفّذ «إرسال رسالة اختبار للحساب المرتبط» وتحقق من Message ID ومن وصول الرسالة.

لا تطبع القيم السرية في logs، ولا تنسخها إلى Issues أو Pull Requests.