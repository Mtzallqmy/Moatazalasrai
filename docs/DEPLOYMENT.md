# النشر

## تسلسل الإصدار

1. شغّل `npm ci`.
2. شغّل lint وtypecheck والاختبارات وbuild.
3. طبّق migrations مرة واحدة من release job أو one-off shell.
4. انشر التطبيق.
5. افحص `/api/health` ثم `/api/ready`.
6. لا تحول الحركة قبل نجاح readiness.

لا يشغّل التطبيق migrations عند كل start أو HTTP request.

## Docker

```bash
docker build -t moataz-agent-platform .
docker run --rm -p 3000:3000 --env-file .env moataz-agent-platform
```

## Railway

- اربط المستودع.
- أضف خدمة PostgreSQL إلى المشروع نفسه.
- في خدمة التطبيق، اجعل `DATABASE_URL` مرجعًا إلى متغير خدمة PostgreSQL (عادةً `${{Postgres.DATABASE_URL}}`) بدل نسخ بيانات الاتصال يدويًا.
- اضبط `APP_URL`, `CREDENTIAL_ENCRYPTION_KEY` و`NODE_ENV=production`.
- يستخدم التطبيق مشغّل PostgreSQL TCP مباشرًا ومتوافقًا مع عنوان Railway الداخلي.
- يشغّل `railway.json` الأمر `npm run db:migrate` كـPre-deploy Command مرة واحدة قبل بدء النسخة الجديدة.
- بعد نجاح الـmigration يبدأ التطبيق، ثم يستخدم Railway `/api/ready` قبل تحويل المرور.
- إذا فشلت خطوة Pre-deploy فتحقق من `DATABASE_URL` وسجل migration؛ لا تستبدل readiness بفحص سطحي لإخفاء قاعدة غير مهيأة.
- يمكن زيادة مهلة جملة migration عبر `MIGRATION_TIMEOUT_MS` عند وجود قاعدة بعيدة بطيئة.

## Cloudflare/OpenNext

المشروع يحتوي إعداد OpenNext و`nodejs_compat`. نجح `npm run cf:build` في بيئة التسليم وأنشأ Worker، لكن مسارات المصادقة والمزودات تحتاج أيضًا اختبارًا حيًا بعد النشر مع PostgreSQL ومزود حقيقي:

```bash
npm run cf:build
```

تعذر تشغيل `cf:preview` محليًا لأن أداة المعاينة مررت خيارات Vite إلى أمر `next dev` القياسي. لذلك يبقى Docker/Railway هو مسار النشر الأساسي الموصى به، ولا يُعد نجاح الحزمة وحده إثباتًا لنشر Cloudflare إنتاجي.

## التهيئة

التسجيل العام ينشئ أول owner ولا يحتاج تعديلات يدوية على قاعدة البيانات. مسارات bootstrap تحت `/api/v1` مخصصة لتكاملات platform API؛ إن استخدمتها فدوّر `BOOTSTRAP_ADMIN_TOKEN` بعد التهيئة.

## الأسرار

- لا تضع `.env` في Git.
- استخدم secret manager.
- لا تستخدم قاعدة الإنتاج لاختبارات integration أو E2E.
- Live E2E يحتاج مفاتيح مزود اختبار بحدود إنفاق مستقلة.
