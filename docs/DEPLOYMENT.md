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
- اضبط `APP_URL`, `DATABASE_URL`, `CREDENTIAL_ENCRYPTION_KEY` و`NODE_ENV=production`.
- طبّق `npm run db:migrate` في خطوة مستقلة قبل النسخة التي تحتاج migration جديدة.
- `railway.json` يستخدم `/api/ready`.

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
