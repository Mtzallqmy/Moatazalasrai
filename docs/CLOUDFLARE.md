# تشغيل Cloudflare أمام Railway

## النطاق المعماري

يبقى Web وGraphile Worker وPostgreSQL على Railway. يعمل Cloudflare بوصفه DNS/WAF/Proxy، ويوفر Turnstile وR2 وAI Gateway بصورة اختيارية. لا تنشر هذا المستودع كاملًا على Workers ولا تشغّل migrations من أكثر من خدمة.

## إعداد النطاق والـProxy

1. أضف النطاق إلى Cloudflare، ثم أنشئ `CNAME` للواجهة يشير إلى نطاق Railway العام وفعّل السحابة البرتقالية.
2. اضبط SSL/TLS على **Full (strict)** واربط Railway بالنطاق المخصص حتى تكون شهادة origin صالحة.
3. اجعل `APP_URL=https://moatazalalqami.online`. لا تستخدم نطاق Railway في redirects أو callbacks.
4. امنع الوصول المباشر إلى origin بوسيلة Railway/Cloudflare المتاحة قبل ضبط `TRUST_CLOUDFLARE_PROXY=true`. لا تفعّل `TRUST_PROXY_HEADERS=true` إلا عندما يضمن ingress استبدال `X-Forwarded-For`.
5. أنشئ Cache Rule تتجاوز cache لكل `/api/*` وصفحات الحساب والدردشة. التطبيق يرسل أيضًا `Cache-Control` و`CDN-Cache-Control` و`Cloudflare-CDN-Cache-Control: no-store`.
6. اسمح بالـstatic assets ذات البصمة فقط. لا تُنشئ Rule من نوع Cache Everything على HTML أو API.

## Turnstile

أنشئ Managed widget للنطاق، ثم اضبط في Railway:

```dotenv
TURNSTILE_ENABLED=true
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<public-site-key>
TURNSTILE_SECRET_KEY=<server-secret>
TURNSTILE_EXPECTED_HOSTNAME=moatazalalqami.online
```

التحقق يتم عبر Siteverify من الخادم، ويفحص `success` و`hostname` و`action` وعمر التحدي، مع مهلة خمس ثوانٍ ومنع إعادة استخدام hash التوكن. السر ليس `NEXT_PUBLIC_*` ولا يسجل. تطبيق Flutter لا يتغير؛ تظل مسارات الهاتف محمية بالـrate limit والجلسات ولا تستخدم widget الويب.

لاختبارات Playwright المعزولة فقط استخدم `.env.playwright.example` الذي يحتوي مفاتيح Cloudflare الوهمية المنشورة رسميًا. لا تضعها في Railway production ولا تخلطها بمفاتيح widget الحقيقي. راجع [توثيق Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) و[مفاتيح الاختبار الرسمية](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).

## R2 الخاص

1. أنشئ bucket خاصًا، من دون Public Development URL أو custom public domain.
2. أنشئ R2 API token بصلاحية Object Read & Write على هذا الـbucket فقط.
3. اضبط:

```dotenv
OBJECT_STORAGE_DRIVER=r2
R2_ACCOUNT_ID=<account-id>
R2_BUCKET_NAME=<private-bucket>
R2_ACCESS_KEY_ID=<s3-access-key>
R2_SECRET_ACCESS_KEY=<s3-secret>
R2_ENDPOINT=
MAX_ATTACHMENT_BYTES=10485760
R2_SIGNED_URL_TTL_SECONDS=300
```

يُنشأ المفتاح بالشكل `<organization UUID>/<random UUID>`، ويُفحص النوع الفعلي والـSHA-256 قبل الرفع. عند اختيار R2 لا تحفظ الملفات الجديدة في PostgreSQL؛ تبقى الملفات القديمة قابلة للقراءة عبر `storage_driver=database`. إذا كان المتغير غير موجود أصلًا يحتفظ الإصدار مؤقتًا بسلوك database القديم كي لا يكسر نشر Railway قائمًا؛ اضبط `r2` صراحة بعد migration. التنزيل الحالي يمر عبر endpoint مصادق ومقيد بالمؤسسة/المالك. الروابط الموقعة متاحة في abstraction ولكن ليست واجهة عامة افتراضيًا لأنها bearer URLs. راجع [توثيق R2 S3 والموقع](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

## AI Gateway الاختياري

الوضع الافتراضي اتصال مباشر ومفاتيح BYOK المشفرة كما هي. عند قرار مدير المنصة:

```dotenv
CLOUDFLARE_AI_GATEWAY_ENABLED=true
CLOUDFLARE_ACCOUNT_ID=3daab68819d22a2285e860c07837884f
CLOUDFLARE_AI_GATEWAY_ID=moataz-ai
OPENAI_BASE_URL=https://gateway.ai.cloudflare.com/v1/3daab68819d22a2285e860c07837884f/moataz-ai/compat
CLOUDFLARE_API_TOKEN=
```

يمر OpenAI BYOK في رأس Authorization المعتاد. `CLOUDFLARE_API_TOKEN` اختياري
لـAuthenticated Gateway فقط ويرسل في `cf-aig-authorization`. تمر استدعاءات
OpenAI عبر `LLMGateway`، بينما تبقى Anthropic وGemini والمزودات المتوافقة
الأخرى مباشرة. يعطل التطبيق cache وتسجيل payload، ويضع مهلة 60 ثانية ومحاولة
بديلة مباشرة واحدة فقط قبل بدء stream. راجع
[الدليل التشغيلي المفصل](cloudflare-ai-gateway.md).

## WAF وRate Limiting

- طبّق managed rules أولًا في log mode ثم block بعد مراجعة false positives.
- ضع rate limits على `/api/auth/*` والـwebhooks والرفع، مع استثناءات محددة لا wildcard واسع.
- لا تعتمد على WAF بدل rate limits داخل التطبيق.
- راقب `CF-Ray` مع `x-request-id` من دون Authorization أو Cookie أو prompts.

## النشر والرجوع

1. خذ backup لقاعدة PostgreSQL واختبر إمكانية القراءة منه.
2. شغّل `npm run db:migrate:all` كـRailway pre-deploy مرة واحدة؛ migration توسعية وتبقي بيانات الملفات القديمة.
3. انشر Web ثم Worker، وكل flags الجديدة `false` و`OBJECT_STORAGE_DRIVER=local` أولًا.
4. افحص `/api/health` و`/api/ready` وتسجيل الدخول والرفع والتنزيل.
5. فعّل R2 أولًا واختبر ملفًا جديدًا، ثم Turnstile، ثم الثقة بعنوان Cloudflare بعد منع bypass، ثم AI Gateway على مؤسسة اختبار.
6. راقب 4xx/5xx وزمن Siteverify وأخطاء R2 وTTFT للمزودات.

للرجوع عطّل `CLOUDFLARE_AI_GATEWAY_ENABLED` ثم `TURNSTILE_ENABLED`، وأعد `TRUST_CLOUDFLARE_PROXY=false`. لا تعِد `OBJECT_STORAGE_DRIVER=local` قبل التأكد من بقاء R2 متاحًا للملفات الجديدة؛ النسخة التي تقرأ R2 يجب أن تظل منشورة. لا تحذف أعمدة migration أو bucket أثناء الرجوع.
