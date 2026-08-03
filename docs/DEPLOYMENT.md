# النشر

## Worker مستقل على Railway

أنشئ خدمة ثانية من المستودع نفسه، دون pre-deploy migration، واجعل Start Command هو `npm run worker`. اضبط `AI_WORKER_ENABLED=true` فيها فقط. تبقي خدمة Web الأمر `npm run db:migrate:all` في pre-deploy و`npm start` للتشغيل.

ابدأ بـWorker replica واحدة. تشترك الخدمتان في `DATABASE_URL` وجميع متغيرات keyring نفسها. انشر أولًا والميزات معطلة، تحقق من `/api/health` و`/api/ready`، ثم فعّل RAG والأدوات والذاكرة تدريجيًا.

للرجوع: عطّل Feature Flags، أوقف Worker، وأعد نشر Web commit السابق. لا تحذف الجداول أثناء الاستجابة للحادث.

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
- يشغّل `railway.json` الأمر `npm run db:migrate:all` كـPre-deploy Command مرة واحدة قبل بدء النسخة الجديدة.
- بعد نجاح الـmigration يبدأ التطبيق، ثم يستخدم Railway `/api/ready` قبل تحويل المرور.
- إذا فشلت خطوة Pre-deploy فتحقق من `DATABASE_URL` وسجل migration؛ لا تستبدل readiness بفحص سطحي لإخفاء قاعدة غير مهيأة.
- يمكن زيادة مهلة جملة migration عبر `MIGRATION_TIMEOUT_MS` عند وجود قاعدة بعيدة بطيئة.

## Cloudflare أمام Railway

Railway/Docker هو runtime الأساسي. لا تُنقل PostgreSQL أو Graphile Worker أو Next.js إلى Cloudflare Workers في هذه المرحلة. يُستخدم Cloudflare DNS/Proxy وTurnstile وR2 وAI Gateway الاختياري فقط. راجع [دليل Cloudflare](CLOUDFLARE.md).

عند استخدام التخزين المحلي داخل Docker اربط volume دائمًا إلى `/app/.data`; لا تستخدمه مع عدة replicas. للإنتاج اختر `OBJECT_STORAGE_DRIVER=r2`. يبقى pre-deploy هو `npm run db:migrate:all` مرة واحدة، ولا ينفذ Web أو Worker migrations عند البدء.

### تفعيل منصة مزوّدي Cloudflare تدريجيًا

1. أضف معرّفات الحساب والبوابة إلى Web وWorker، وأضف فقط الرموز المطلوبة للمسار المختار.
2. انشر أولًا والاتصالات الحالية على `direct` والـfallback معطل.
3. شغّل migration ثم تحقق من اتصال خادمي موجود ومن المحادثة والبث.
4. أنشئ اتصال staging عبر provider-native أو REST واختبره قبل جعله افتراضيًا.
5. استخدم Workers AI فقط في نشر OpenNext/Wrangler الذي يحتوي binding `AI`.
6. راقب HTTP status وrequest/trace ID وlatency وحالة `interrupted` للبث، دون payloads أو أسرار.
7. للرجوع عطّل الاتصال أو أعده إلى `direct`، وأبق الـfallback معطلًا.

لا يستخدم التنفيذ الجديد `OPENAI_BASE_URL` أو endpoint `/compat`. `CLOUDFLARE_AI_GATEWAY_TOKEN` مخصص لـAuthenticated Gateway، و`CLOUDFLARE_API_TOKEN` مخصص لـAI Gateway REST API، ولا يحل أي منهما محل BYOK إلا عندما يكون الاتصال مضبوطًا صراحة على مرجع Cloudflare.

راجع [دليل منصة مزوّدي Cloudflare](cloudflare-ai-gateway.md).

## التهيئة

التسجيل العام ينشئ أول owner ولا يحتاج تعديلات يدوية على قاعدة البيانات. مسارات bootstrap تحت `/api/v1` مخصصة لتكاملات platform API؛ إن استخدمتها فدوّر `BOOTSTRAP_ADMIN_TOKEN` بعد التهيئة.

## الأسرار

- لا تضع `.env` في Git.
- استخدم secret manager.
- لا تستخدم قاعدة الإنتاج لاختبارات integration أو E2E.
- Live E2E يحتاج مفاتيح مزود اختبار بحدود إنفاق مستقلة.
