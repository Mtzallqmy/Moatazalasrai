# تكامل WhatsApp Business Platform

يستخدم هذا التكامل **WhatsApp Cloud API الرسمي من Meta فقط**. لا توجد جلسات QR، ولا WhatsApp Web، ولا Puppeteer، ولا مكتبات غير رسمية.

## التدفق

1. المستخدم المسجل يفتح `/dashboard/settings` ويضغط **ربط حسابي بواتساب**.
2. يستخرج الخادم `userId` من جلسة HTTP ولا يقبله من المتصفح.
3. ينشئ الخادم رمزًا عشوائيًا قصير العمر، ويحفظ HMAC-SHA-256 فقط.
4. يعيد الخادم رابط `wa.me` برسالة `CONNECT <token>` مشفرة داخل الرابط.
5. يرسل المستخدم الرسالة بنفسه إلى رقم المشروع.
6. يتحقق Webhook من `X-Hub-Signature-256` باستخدام `META_APP_SECRET`.
7. يستهلك الرمز داخل transaction مع `FOR UPDATE` ويربط `message.from` بالحساب مرة واحدة فقط.
8. يرسل البوت تأكيدًا وقائمة ثابتة: **حسابي**، **فتح الدردشة**، **إلغاء الربط**.

## متغيرات البيئة

```text
WHATSAPP_INTEGRATION_ENABLED
META_APP_ID
META_APP_SECRET
META_GRAPH_API_VERSION
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_BUSINESS_ACCOUNT_ID
WHATSAPP_DISPLAY_PHONE_NUMBER
WHATSAPP_WEBHOOK_VERIFY_TOKEN
WHATSAPP_CONNECT_TOKEN_SECRET
WHATSAPP_CONNECT_TOKEN_TTL_MINUTES
APP_URL
PUBLIC_APP_URL
```

- `META_GRAPH_API_VERSION`: نسخة Graph API بصيغة مثل `v23.0`. لا يثبت المشروع نسخة دائمة في الكود.
- `WHATSAPP_DISPLAY_PHONE_NUMBER`: رقم المشروع بصيغة دولية؛ تُزال المسافات و`+` عند بناء `wa.me`.
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: قيمة عشوائية طويلة تضع القيمة نفسها في Meta.
- `WHATSAPP_CONNECT_TOKEN_SECRET`: سر مستقل لا يقل عن 32 حرفًا لتوليد HMAC لرموز الربط.
- مدة الرمز الافتراضية 10 دقائق، والحد المقبول من 5 إلى 60 دقيقة.
- `PUBLIC_APP_URL` هو الأصل العام الذي يفتح للمستخدم من WhatsApp. يعود التنفيذ إلى `APP_URL` عند غيابه.

لا تضع قيم الأسرار في Git أو متغيرات `NEXT_PUBLIC_*`.

## Migration

```bash
npm run db:migrate:all
```

تضيف migration `drizzle/0028_whatsapp_business_platform.sql`:

- `whatsapp_connections`
- `whatsapp_link_tokens`
- `whatsapp_webhook_events`

يمنع الفهرس الفريد ربط `wa_id` نفسه بأكثر من مستخدم، ويمنع `message_id` المكرر من إعادة تنفيذ Webhook.

## Callback URL

```text
https://YOUR_PUBLIC_HOST/api/webhooks/whatsapp
```

في Railway تكون عادة:

```text
${PUBLIC_APP_URL}/api/webhooks/whatsapp
```

استخدم HTTPS في الإنتاج.

## إعداد Meta

1. أنشئ Meta App وأضف منتج WhatsApp.
2. اربط WhatsApp Business Account ورقم Cloud API.
3. ضع Callback URL أعلاه.
4. ضع قيمة `WHATSAPP_WEBHOOK_VERIFY_TOKEN` في حقل Verify Token.
5. اشترك في حقل `messages` للـWABA.
6. تأكد أن `WHATSAPP_PHONE_NUMBER_ID` يخص الرقم الذي سيستقبل رسائل `CONNECT`.
7. امنح التوكن صلاحيات `whatsapp_business_messaging` و`whatsapp_business_management` حسب العمليات المستخدمة.

لا يحتاج الاشتراك إلى Webhook مستقل لكل رقم داخل WABA؛ يجب الاشتراك في WABA المطلوب.

## Railway

أضف المتغيرات السابقة إلى خدمة الويب. شغّل migration في Pre-Deploy أو باستخدام الأمر الحالي للمشروع:

```bash
npm run db:migrate:all
```

بعد النشر افحص:

```text
GET /api/health
GET /api/ready
```

ثم نفّذ تحقق Webhook من لوحة Meta.

## الاختبار المحلي

1. شغّل PostgreSQL واضبط `.env.local` بقيم اختبار، دون توكن إنتاجي.
2. شغّل:

```bash
npm ci
npm run db:migrate:all
npm run dev
```

3. استخدم tunnel HTTPS موثوقًا لعرض `/api/webhooks/whatsapp` إلى Meta.
4. لا يمكن تزوير POST يدويًا دون توقيع HMAC صحيح من `META_APP_SECRET`.
5. اختبارات الوحدة تستخدم mocks ولا ترسل أي رسالة حقيقية.

```bash
npm test -- tests/whatsapp-business.test.ts tests/whatsapp-webhook-route.test.ts tests/whatsapp-connect-route.test.ts
TEST_DATABASE_URL="$DATABASE_URL" npm run test:integration -- tests/integration/whatsapp-postgres.test.ts
```

## اختبار الربط من البداية إلى النهاية

1. سجّل الدخول وافتح إعدادات الحساب.
2. اضغط **ربط حسابي بواتساب**.
3. تأكد أن الصفحة لا تعتبر الحساب مرتبطًا بمجرد فتح WhatsApp.
4. أرسل رسالة `CONNECT` الجاهزة دون تعديل.
5. انتظر رسالة التأكيد والقائمة.
6. عد إلى الإعدادات؛ يتوقف polling بعد ظهور **مرتبط**.
7. اختبر **حسابي** وتأكد أن البريد مخفي جزئيًا.
8. اختبر **فتح الدردشة**؛ يتطلب الموقع جلسة دخول صالحة.
9. اختبر **إلغاء الربط** وتأكد أن الرسائل اللاحقة لا تصل إلى بيانات الحساب.

## الانتقال من توكن الاختبار إلى الإنتاج

توكن Getting Started المؤقت مناسب للاختبار فقط. للإنتاج:

1. أنشئ System User داخل Meta Business Portfolio.
2. امنحه الأصول المطلوبة للـWABA والرقم.
3. أنشئ System User access token بالصلاحيات اللازمة.
4. استبدل `WHATSAPP_ACCESS_TOKEN` داخل Railway Secret/Variable.
5. أعد النشر واختبر إرسال رسالة خدمة داخل نافذة المحادثة.
6. ألغِ التوكن القديم بعد نجاح الاختبار.

لا يسجل التطبيق التوكن، ولا يعيده في API، ولا يرسله إلى الواجهة.

## الرسائل والقوالب

التنفيذ الحالي يرد فقط على رسائل المستخدم داخل سياق الخدمة. لا توجد حملات أو إرسال تسويقي جماعي. خدمة الإرسال معزولة بحيث يمكن إضافة message templates معتمدة لاحقًا للإرسال خارج نافذة المحادثة، لكن لا يوجد إرسال تلقائي خارجها الآن.

## استكشاف الأخطاء

- **GET verification يعيد 403:** تحقق من `hub.mode=subscribe` ومن تطابق Verify Token حرفيًا.
- **POST يعيد 401:** التوقيع لا يطابق raw body أو `META_APP_SECRET` غير صحيح.
- **لا تصل الرسائل:** تأكد من الاشتراك في `messages` على WABA الصحيح ومن تطابق Phone Number ID.
- **رمز الربط منتهي:** أنشئ رابطًا جديدًا؛ الروابط السابقة تُلغى تلقائيًا.
- **الرقم مرتبط بحساب آخر:** ألغِ الربط من الحساب الأصلي أولًا؛ لا يوجد نقل صامت للملكية.
- **Meta تعيد 401/403:** راجع نوع التوكن والأصول والصلاحيات، ولا تعتمد على إعادة المحاولة.
- **Meta تعيد 429 أو 5xx:** يستخدم العميل retries محدودة للأخطاء المؤقتة فقط.

## الأمان والخصوصية

- لا يُحفظ رمز الربط الخام.
- لا يُسجل نص الرسالة افتراضيًا.
- لا تُسجل Authorization headers أو access tokens.
- لا يعاد `wa_id` كاملًا إلى المتصفح.
- الاستهلاك والربط وإبطال الرموز تتم ذريًا.
- `message_id` فريد لمنع replay.
- لا تنفذ كلمة مرور أو دفعًا أو تغييرًا حساسًا عبر ارتباط WhatsApp وحده.
