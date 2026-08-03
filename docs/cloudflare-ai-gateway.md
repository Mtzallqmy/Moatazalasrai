# منصة مزوّدي الذكاء الاصطناعي عبر Cloudflare

## النطاق المعماري

يبقى Next.js وPostgreSQL وGraphile Worker على بيئة النشر الحالية. تضيف المنصة ثلاثة مسارات خادمية واضحة دون استبدال Adapters الموجودة:

1. **اتصال مباشر** إلى OpenAI أو Anthropic أو Google AI Studio أو مزوّد OpenAI-compatible، باستخدام مفتاح BYOK المشفّر الحالي.
2. **Cloudflare AI Gateway provider-native** للمزوّدات الخارجية، باستخدام BYOK المشفّر أو `Provider Key Alias` محفوظ في Cloudflare.
3. **Cloudflare AI Gateway REST API** و**Workers AI binding** للمسارات التي تدير Cloudflare بيانات اعتمادها أو النموذج نفسه.

لا يستخدم التنفيذ الجديد Universal/Compatibility endpoint القديم، ولا يكوّن عنوان `/compat`. تُبنى العناوين مركزيًا في `src/lib/providers/cloudflare-endpoints.ts`.

## المعرّفات الثابتة

تستخدم المنصة المعرّفات التالية بصرف النظر عن الاسم المعروض:

- `cloudflare-workers-ai`
- `cloudflare-ai-gateway`
- `openai`
- `anthropic`
- `google-ai-studio`
- `custom-openai-compatible`

يبقى حقل `provider` القديم متوافقًا مع مخطط المشروع (`openai`, `anthropic`, `gemini`, `openai_compatible`). تضيف الأعمدة الجديدة `provider_type_id` و`transport_mode` التمييز التشغيلي من دون كسر السجلات الحالية.

## متغيرات البيئة

اضبط الأسماء التالية على Web وGraphile Worker عند استخدام المسارات المقابلة:

```dotenv
CLOUDFLARE_AI_GATEWAY_ENABLED=false
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_AI_GATEWAY_ID=default
CLOUDFLARE_AI_GATEWAY_TOKEN=
CLOUDFLARE_API_TOKEN=
AI_PROVIDER_FALLBACK_ENABLED=false
AI_PROVIDER_DIRECT_FALLBACK_ENABLED=false
CLOUDFLARE_AI_LIVE_TEST=false
```

- `CLOUDFLARE_AI_GATEWAY_TOKEN`: رمز Authenticated Gateway، ويرسل في `cf-aig-authorization` عند استخدام provider-native endpoint.
- `CLOUDFLARE_API_TOKEN`: Cloudflare API Token محدود الصلاحية لاستدعاء AI Gateway REST API الحالي.
- Provider Key Alias لا يحتوي قيمة المفتاح؛ القيمة الفعلية تبقى في Cloudflare Secrets Store.
- مفتاح BYOK المباشر أو المار عبر provider-native endpoint يبقى مشفّرًا في PostgreSQL باستخدام الآلية الحالية.

## العناوين المركزية

### Provider-native

```text
https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/{provider}
```

المزوّدات المدعومة في الطبقة الحالية:

- OpenAI: `/openai`
- Anthropic: `/anthropic`
- Google AI Studio: `/google-ai-studio/v1`

يُرسل `cf-aig-byok-alias` عند اختيار Provider Key Alias. في هذا الوضع لا ترسل المنصة مفتاح المزود في `Authorization` أو `x-api-key`.

### AI Gateway REST API

```text
https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions
```

يُرسل Gateway ID في `cf-aig-gateway-id`. اسم النموذج يجب أن يتبع صيغة REST التي تعلنها Cloudflare للمزوّد، مثل `openai/...` أو `anthropic/...` أو `google/...`.

### Workers AI

عند تشغيل Next.js عبر OpenNext على Cloudflare، يقرأ التطبيق binding باسم `AI` من `env.AI`. الإعداد موجود في `wrangler.toml`:

```toml
[ai]
binding = "AI"
```

لا تُرسل مفاتيح BYOK للمزوّدات الخارجية عبر Workers AI binding. يستخدم هذا المسار نماذج Workers AI الرسمية ذات المعرّفات التي تبدأ بـ`@cf/`.

## حالة المزود والتشخيص

تخزن المنصة حالة صحية صريحة ولا تحول `unknown` إلى `healthy`:

- `unconfigured`
- `validating`
- `healthy`
- `degraded`
- `rate_limited`
- `unauthorized`
- `model_unavailable`
- `network_error`
- `misconfigured`
- `disabled`
- `unknown`

طبقة `normalizeError` تحفظ دليل الخطأ المتاح فقط: HTTP status، فئة الخطأ، request/trace ID عند وجوده، وإمكانية إعادة المحاولة. لا تسجل Authorization أو Cookies أو prompt أو response أو قيمة السر.

HTTP 200 لا يكفي لاعتبار الفحص ناجحًا. اختبار الحفظ يراجع بنية الاستجابة، وجود نص فعلي، وصحة النموذج المختار. عند غياب استجابة HTTP تستخدم الرسالة صياغة غير قطعية لأن صحة المفتاح لا يمكن تأكيدها.

## الاختبار والحفظ

مسار الحفظ هو:

1. تحقق Zod من الحقول والمعرّفات والعنوان.
2. تحقق من توافق `transportMode` و`credentialMode`.
3. تحقق من وجود السر المشفّر أو Provider Key Alias أو Workers binding دون كشف القيمة.
4. اختبار قصير وثابت لا يستخدم بيانات مستخدم.
5. تصنيف النتيجة وتحديث الحالة الصحية.
6. حفظ الإعداد، سجل النماذج، والحالة داخل transaction.
7. إعادة قراءة السجل المحفوظ قبل الرد.

يمكن للمشرف اختيار حفظ إعداد فشل اختباره بحالة غير سليمة؛ لا يصبح المزود `healthy` ولا يُستخدم افتراضيًا بسبب ذلك.

## Fallback

الـfallback مغلق افتراضيًا. لا يعمل إلا عند تفعيل:

```dotenv
AI_PROVIDER_FALLBACK_ENABLED=true
```

والـfallback المباشر من AI Gateway provider-native يحتاج أيضًا:

```dotenv
AI_PROVIDER_DIRECT_FALLBACK_ENABLED=true
```

يسمح فقط لأخطاء عابرة موثقة قبل بدء البث، مثل timeout أو network أو 429 أو حالات 5xx المحددة. لا يستخدم عند:

- مفتاح غير صالح أو 401.
- نقص صلاحية أو 403.
- نموذج غير موجود.
- validation أو إعداد غير صالح.
- بعد بدء stream، لتجنب تكرار التوليد.

يسجل التشغيل المزود المطلوب، فئة الفشل، المزود/المسار البديل، النموذج والنتيجة، دون بيانات حساسة.

## منع الردود الوهمية

عند فشل المزود لا تنشئ المنصة رسالة مساعد مكتملة ولا تضيف نصًا تخمينيًا. إن وصل جزء من stream ثم انقطع، تحفظ الرسالة بالحالة `interrupted` مع النص الجزئي فقط. إن لم يصل نص، تحفظ الحالة `failed` من دون رسالة نجاح. يبقى زر إعادة المحاولة متاحًا، ولا تسجل usage ناجحًا غير مؤكد.

## التشغيل محليًا

```bash
npm ci
npm run db:migrate:all
npm run dev
```

- المسار المباشر يعمل في Node/Railway عند وجود بيانات اعتماد اختبار.
- Workers AI يحتاج تشغيل OpenNext/Wrangler وbinding `AI`؛ لن يعمل داخل `next dev` العادي.
- اختبارات الوحدة تستخدم mocks ولا تحتاج إلى أسرار.
- الاختبار الحي اختياري ومحمي بـ`CLOUDFLARE_AI_LIVE_TEST=true` وبيانات اعتماد staging محدودة.

## النشر والرجوع

1. طبّق migration مرة واحدة قبل Web/Worker.
2. انشر والمتغيرات والـfallback معطلة.
3. اختبر اتصالًا مباشرًا موجودًا للتأكد من عدم حدوث regression.
4. اختبر provider-native على مؤسسة staging.
5. اختبر REST أو Workers AI كلٌ في بيئته الصحيحة.
6. لا تجعل اتصالًا جديدًا افتراضيًا قبل نجاح الاختبار.

للرجوع عطّل اتصالات Cloudflare من لوحة المزودين أو عطّل flags. تبقى بيانات BYOK والسجلات الحالية، ولا تحتاج حذف الأعمدة التوسعية.
