# Telegram Central Bot

## المعمارية

تستخدم المنصة بوت Telegram واحدًا فقط مملوكًا للمنصة. التوكن والسر موجودان في متغيرات Railway ولا يُخزنان في جداول المؤسسات. يستقبل المسار `/api/webhooks/telegram` جميع التحديثات، يتحقق من السر، يحفظ `update_id` قبل المعالجة، ثم يحسم رابط المستخدم وصلاحياته قبل تمرير الرسالة إلى Channel Router.

المسار القديم `/api/webhooks/telegram/[integrationId]` مخصص للتوافق التاريخي فقط. تكاملات Telegram القديمة تبقى في قاعدة البيانات ولا يستخدمها المسار المركزي.

## متغيرات Railway

المطلوبة عند `TELEGRAM_INTEGRATION_ENABLED=true`:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`، قيمة عشوائية لا تقل عن 16 حرفًا.
- `TELEGRAM_LINK_CODE_SECRET`، قيمة عشوائية لا تقل عن 32 حرفًا.
- `PUBLIC_APP_URL` أو `APP_URL` باستخدام HTTPS في الإنتاج.

الاختيارية:

- `TELEGRAM_WEBHOOK_URL`؛ الافتراضي هو `${PUBLIC_APP_URL || APP_URL}/api/webhooks/telegram`.
- `TELEGRAM_LINK_CODE_TTL_MINUTES=10`
- `TELEGRAM_LINK_CODE_MAX_ATTEMPTS=5`
- `TELEGRAM_LINK_CODE_LENGTH=6`
- `TELEGRAM_ALLOW_USER_BOT_TOKENS=false`
- `TELEGRAM_UPDATE_MODE=webhook`
- `TELEGRAM_WEBHOOK_MAX_BYTES=1048576`

لا تضع أي قيمة حقيقية في المستودع أو السجلات.

## إنشاء البوت

1. افتح BotFather في Telegram.
2. استخدم `/newbot` وحدد الاسم واسم المستخدم.
3. خزّن التوكن الناتج في `TELEGRAM_BOT_TOKEN` داخل Railway.
4. ولّد سرين مستقلين، مثل `openssl rand -base64 48`، للـWebhook وأكواد الربط.

## ضبط Webhook

بعد ضبط متغيرات Railway وتشغيل المهاجرات:

```bash
npm run telegram:webhook:setup
```

الأمر idempotent: يقرأ `getWebhookInfo` ويستدعي `setWebhook` فقط عند الحاجة، ثم يعيد التحقق. لا يطبع التوكن أو السر.

للتحقق اليدوي الآمن شغّل الأمر نفسه أو استخدم Telegram `getWebhookInfo` من بيئة محمية دون نسخ التوكن إلى سجل عام.

## تدفق الربط

1. المستخدم يفتح بطاقة «ربط تيليجرام» في لوحة التكاملات.
2. يضغط «إنشاء رمز ربط».
3. الخادم ينشئ رمزًا رقميًا مؤقتًا، ويخزن HMAC فقط في `telegram_link_codes`.
4. المستخدم يفتح الرابط العميق أو يرسل الرمز إلى البوت.
5. Webhook يستهلك الرمز داخل transaction مع قفل صف.
6. يُنشأ أو يُحدّث سجل `telegram_account_links` وتكتب عملية التدقيق `telegram.account.linked`.

لا يُنقل Telegram user ID من حساب إلى حساب آخر تلقائيًا.

## إدارة الميزات

كل ميزة Fail-closed. عدم وجود سجل مفعّل في `telegram_feature_permissions` يعني المنع. مفاتيح الميزات:

- `telegram.chat`
- `telegram.agents`
- `telegram.files`
- `telegram.images`
- `telegram.audio`
- `telegram.video`
- `telegram.notifications`
- `telegram.admin_commands`

المشرف الذي يملك `integrations:manage` يستطيع تعديلها من لوحة التكاملات. المستخدم العادي لا يستطيع تعديل صلاحياته.

## فصل الحساب

من البطاقة اضغط «فصل الحساب». يغيّر النظام الحالة إلى `revoked` ويكتب `telegram.account.unlinked`. لا تُحذف المحادثات التاريخية.

## ترحيل التكاملات القديمة

1. اضبط متغيرات البوت المركزي وشغّل migration `0039_central_telegram_bot.sql`.
2. شغّل `npm run telegram:webhook:setup`.
3. اربط المستخدمين من لوحة التحكم.
4. اترك `TELEGRAM_ALLOW_USER_BOT_TOKENS=false`.
5. راقب التحديثات المركزية والمحادثات.
6. احتفظ بسجلات `integrations` القديمة للقراءة التاريخية؛ لا تستخدم توكناتها في Webhook المركزي.

## استكشاف الأخطاء

- `401` من Webhook: تحقق من تطابق `TELEGRAM_WEBHOOK_SECRET` مع السر المسجل لدى Telegram.
- `413`: ارفع `TELEGRAM_WEBHOOK_MAX_BYTES` ضمن الحدود الآمنة إذا كانت الرسالة مشروعة.
- رسالة «الميزة غير مفعلة»: فعّل feature key المناسب للمستخدم.
- رمز ربط مرفوض: أنشئ رمزًا جديدًا؛ الرموز منتهية أو مستهلكة أو متجاوزة للمحاولات لا يعاد استخدامها.
- البوت لا يرد: شغّل `npm run telegram:webhook:setup` وافحص `pending_update_count` وحالة خدمة Railway.
