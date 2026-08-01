# دليل التشغيل

## مؤشرات الصحة

- `/api/health`: liveness سطحي ولا ينبغي أن يعتمد على مزود خارجي.
- `/api/ready`: readiness مع PostgreSQL والمخطط؛ لا يشغّل migrations.
- راقب معدل 5xx و429، P95/P99، pool saturation، عمر أقدم job، retries، وحالة Worker heartbeat. لا تسجل prompts أو رسائل أو tokens أو محتوى ملفات.

## نشر آمن

1. خذ نسخة PostgreSQL متسقة وسجل مرجعها واختبر إمكانية قراءتها.
2. شغّل `npm run db:migrate:all` مرة واحدة كـpre-deploy. migration `0020` يجب أن يسبق web الجديد.
3. انشر web وانتظر نجاح `/api/ready`.
4. انشر Worker مستقلًا وتحقق من heartbeat وعمق الصف.
5. اترك الميزات الخارجية الجديدة معطلة حتى smoke tests.
6. اختبر login، تبديل المؤسسة، API key محدود، provider validation، queue، وTelegram acknowledgement.
7. فعّل تدريجيًا وراقب 30 دقيقة على الأقل.

Rollback للكود آمن ما دامت migrations additive. لا تحذف `0020`: الإصدار الجديد يعتمد على scopes الصريحة. عند rollback أبقِ schema، أعد web/worker السابقين، وتحقق من readiness.

## PostgreSQL

- عند الانقطاع: أوقف قبول الأعمال الثقيلة، أبقِ liveness، لا تشغل migration من replica، وراجع pool/latency/failover.
- عند فشل migration: أوقف rollout، لا تعد تشغيل statements عشوائيًا، افحص `_platform_migrations`، واستعد النسخة إذا ثبت تغيير بيانات غير صحيح.
- RPO مبدئي: 24 ساعة كحد أعلى إلى أن يحدد المنتج وتيرة backup؛ RTO مبدئي: 4 ساعات. اختبر restore ربع سنويًا.

## Worker queue

- عند التراكم: افحص heartbeat وأقدم job ونوع الخطأ قبل زيادة concurrency.
- لا تعِد job غير idempotent يدويًا. استخدم job keys، وتحقق من حالة المورد/tenant والإلغاء.
- أوقف `AI_WORKER_ENABLED` كـkill switch عند event storm أو خطأ تنفيذي متكرر.

## تعطل مزود أو تكامل

- عطّل credential/integration المتأثر، لا تنقل traffic إلى مزود مختلف دون موافقة سياسة الخصوصية/التكلفة.
- راقب circuit-open والحالة 401/402/429/5xx.
- webhook storm: عطّل التكامل، احتفظ بـidempotency IDs، ثم أعد التشغيل تدريجيًا.

## تدوير مفتاح التشفير

1. Backup واختبار restore.
2. إن كانت البيانات `v1`: أبقِ المفتاح القديم كحالي، عيّن له ID ثابتًا، وشغّل `npm run secrets:reencrypt` لتحويلها إلى `v2.old`.
3. تحقق من audit action `secret.reencrypted` ومن أن التشغيل الثاني يعرض `rotated: 0`.
4. ضع المفتاح الجديد في `CREDENTIAL_ENCRYPTION_KEY` وID جديدًا، وضع القديم في JSON `CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS` على web وworker معًا.
5. شغّل الأداة ثانية، ثم smoke tests للمزودات وMCP والتكاملات.
6. أبقِ القديم خلال نافذة rollback. لا تحذفه قبل فحص عدم وجود envelope بالـID القديم ونجاح backup جديد.

