# Cloudflare AI Gateway

## النطاق

يظل Next.js وPostgreSQL وGraphile Worker على Railway. Cloudflare AI Gateway طبقة
نقل اختيارية لاستدعاءات OpenAI فقط، ولا يستبدل OpenAI أو يخزن مفاتيح BYOK ولا
يغير تشفيرها. تبقى Anthropic وGoogle Gemini والمزودات المتوافقة مع OpenAI على
Adapters المباشرة الحالية.

## الإعداد

اضبط المتغيرات نفسها على خدمتي Web وWorker:

```dotenv
CLOUDFLARE_AI_GATEWAY_ENABLED=false
CLOUDFLARE_ACCOUNT_ID=3daab68819d22a2285e860c07837884f
CLOUDFLARE_AI_GATEWAY_ID=moataz-ai
OPENAI_BASE_URL=https://gateway.ai.cloudflare.com/v1/3daab68819d22a2285e860c07837884f/moataz-ai/compat
CLOUDFLARE_API_TOKEN=
```

`CLOUDFLARE_API_TOKEN` سر خادمي اختياري لا يلزم إلا إذا كانت خاصية
Authenticated Gateway مفعلة. عند وجوده يرسل في `cf-aig-authorization` ولا
يستبدل `Authorization: Bearer <OPENAI_BYOK>`.

يفشل بدء الإنتاج برسالة واضحة إذا فُعلت البوابة وغاب Account ID أو Gateway ID أو
`OPENAI_BASE_URL`. غياب القيم لا يؤثر في التشغيل ما دامت الميزة معطلة.

## لماذا يظهر /compat بينما يستخدم التنفيذ /openai؟

Cloudflare أبقت `/compat` للتكاملات الحالية، لكنه Unified Chat Completions API
ويتطلب اسم نموذج بصيغة `provider/model`. المنصة تستخدم كذلك OpenAI Responses
API وتحفظ أسماء النماذج الحالية مثل `gpt-5` دون بادئة. لذلك تتحقق طبقة
`LLMGateway` من عنوان `/compat` المعلن ثم تستخدم شقيقه provider-native
`/openai` داخليًا. هذا يحافظ على:

- Responses API وChat Completions.
- Streaming وTool Calling وstructured output.
- أسماء النماذج المخزنة وعقود Flutter وREST.
- مفتاح OpenAI الخاص بكل مؤسسة في رأس Authorization المعتاد.

لا يخرج هذا التحويل من gateway `moataz-ai`.

## سلوك LLMGateway

المسؤوليات المركزية موجودة في
`src/lib/providers/llm-gateway.ts`:

- اختيار العنوان المباشر أو Gateway.
- إضافة رؤوس Cloudflare دون حذف رؤوس OpenAI.
- `cf-aig-skip-cache=true`.
- `cf-aig-collect-log=false` لمنع حفظ prompt/response في سجلات Gateway.
- مهلة 60 ثانية حتى أول استجابة.
- تعطيل retries الداخلية في Cloudflare عبر `cf-aig-max-attempts=1`.
- محاولة بديلة مباشرة واحدة فقط عند 429 أو 502 أو 503 أو 504 أو خطأ اتصال.
- عدم إعادة المحاولة بعد تسليم استجابة streaming ناجحة وبدء قراءة بياناتها.
- تسجيل JSON آمن: provider ومعرف مؤسسة مشتق وduration وstatusCode وrequestId
  ومسار gateway/fallback فقط.

لا تسجل الطبقة prompts أو responses أو مفاتيح أو Authorization أو Cookies أو
رسائل المستخدم.

## Fallback وحدود التكرار

الطلب الأول يذهب إلى Gateway. إذا أعاد Gateway حالة قابلة لإعادة المحاولة قبل
بدء البث، أو تعذر إنشاء الاتصال، تنفذ محاولة ثانية واحدة مباشرة إلى OpenAI.
لا توجد محاولة ثالثة، ولا retry بعد أي استجابة 2xx حتى لو انقطع stream لاحقًا.
هذا يمنع retry storms ويحد خطر التكرار. إلغاء المستخدم لا يشغل fallback.

## التشخيص

صفحة التشخيص الخاصة بالمالك أو المدير تعرض فقط:

- `AI Gateway Enabled`.
- `AI Gateway Reachable`.
- `Gateway URL`.
- رمز HTTP غير حساس عند فحص الوصول.

فحص الوصول يستخدم HEAD قصيرًا ولا يرسل مفتاح OpenAI أو prompt. استجابة HTTP
حتى لو كانت 401 أو 405 تثبت الوصول إلى edge؛ فشل الشبكة يجعل التشخيص degraded.

## التفعيل الآمن

1. انشر الكود والمتغيرات مع `CLOUDFLARE_AI_GATEWAY_ENABLED=false`.
2. اختبر OpenAI المباشر والفحص والتوليد والبث.
3. فعّل Authenticated Gateway فقط عند الحاجة، وضع Token في Railway secrets.
4. فعّل البوابة على Web واحد.
5. اختبر نموذجًا يدعم Responses API وTool Calling وstreaming.
6. راقب 429 و502 و503 و504 وlatency ووقت أول token.
7. فعّل Worker بعد استقرار Web.

## الرجوع

اضبط `CLOUDFLARE_AI_GATEWAY_ENABLED=false` على Web وWorker ثم أعد نشرهما.
يعود كل Adapter إلى العناوين المحفوظة الحالية فورًا. لا توجد migration أو
تغييرات قاعدة بيانات أو مفاتيح تحتاج استعادة.

## تحقق الاختبارات

```bash
npm run lint
npm run typecheck
npm test -- tests/cloudflare-gateway.test.ts
npm run build
```

الاختبارات الحية تحتاج مفتاح OpenAI محدود الإنفاق وبيئة staging، ولا تستخدم
أسرار الإنتاج داخل GitHub Actions.
