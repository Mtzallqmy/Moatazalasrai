# تدقيق وإعادة هندسة منصة Moatazalasrai

تاريخ التدقيق: 2026-08-05

## الملخص التنفيذي

المشروع ليس نموذجًا أوليًا بسيطًا؛ هو منصة SaaS متعددة المؤسسات مبنية على Next.js وReact وTypeScript وPostgreSQL وDrizzle وGraphile Worker. توجد فيه بالفعل طبقات قوية تشمل جلسات مخزنة كـhash، تشفير أسرار BYOK باستخدام AES-256-GCM، عزل المؤسسات، RBAC خادمي، Rate Limiting مخزن في PostgreSQL، CSRF/Origin Validation، حماية SSRF، Webhooks موقعة، Worker مستقل، MCP، تخزين ملفات خاص، اختبارات CI متسلسلة، وصور Docker متعددة المراحل.

كانت الفجوة الأساسية أن قدرات الإدارة موزعة بين كود ثابت ومتغيرات بيئة وصفحات متخصصة، وأن WhatsApp بدأ كتكامل منفصل ولم يكن جزءًا كاملًا من نموذج القنوات. تعالج إعادة الهندسة الحالية ذلك من خلال Channel Platform مشتركة وControl Plane وإشعارات مبنية على Domain Events دون إنشاء نظام موازٍ.

## البنية الحالية

### الواجهة

- Next.js App Router وReact وTypeScript.
- صفحات خادمية للتحميل الأولي ومكونات عميلة للتفاعل.
- Tailwind CSS وواجهة عربية RTL.
- Dashboard Shell وتنقل مشترك بين صفحات الإدارة.
- تطبيق Flutter أصلي داخل `apps/mobile`.

### الخادم

- Route Handlers داخل `src/app/api`.
- خدمات نطاق داخل `src/lib` بدل وضع منطق الأعمال في الواجهات.
- Adapters لمزودي النماذج وMCP والقنوات.
- Graphile Worker لمعالجة الأعمال الخلفية والمتكررة.
- عقود Zod وحدود صريحة لأحجام الطلبات.

### البيانات

- PostgreSQL عبر `pg` وDrizzle ORM.
- Migrations تسلسلية داخل `drizzle/`.
- عزل معظم الجداول بواسطة `organization_id` وفهارس مركبة حسب المؤسسة والحالة والتاريخ.
- فحص readiness يتحقق من وجود الجداول المطلوبة ومن Heartbeat العامل الخلفي.

### النشر والتشغيل

- Railway هو مسار النشر الأساسي.
- Docker متعدد المراحل مع مستخدم غير root.
- Cloudflare اختياري للحماية وR2 وAI Gateway.
- CI متسلسل: تدقيق حزم، lint، typecheck، unit tests، E2E، build، migrations، integration tests، وDocker smoke.

## سجل المخاطر

| الخطورة | المشكلة | الأثر | المعالجة |
|---|---|---|---|
| حرجة | منطق Telegram وWhatsApp لم يكن تحت عقد قناة موحدة مكتملة | تكرار وتباين الصلاحيات والتوجيه | استخراج `ChannelAdapter` وRouter مركزي وتطبيق Telegram وWhatsApp عليه |
| حرجة | Allowlist أدوات القناة لم تكن تصل إلى طبقة تنفيذ الوكيل بالكامل | احتمال تحميل أو تنفيذ أداة خارج سياسة الاتصال | تمرير `allowedToolIds` عبر Router وAgent Runtime وAI SDK وMCP Loader |
| عالية | خصائص الإدارة كانت ثابتة في الكود أو البيئة | يحتاج المالك إلى نشر كود لتشغيل أو تعطيل ميزة | Control Plane للوحدات والميزات والإعدادات والأدوار |
| عالية | لا يوجد Event Outbox موحد لأحداث الموقع | ربط كل ميزة بواتساب مباشرة يخلق اقترانًا وفشلًا متسلسلًا | `domain_events` وGraphile Worker وقواعد إشعارات وقوالب |
| عالية | Cookie الجلسة لا تستخدم بادئة `__Host-` في الإنتاج | حماية أقل ضد تعارضات Domain/Path | انتقال تلقائي إلى `__Host-moataz_session` مع توافق للجلسات القديمة |
| عالية | صلاحيات المؤسسة كانت أدوارًا ثابتة فقط | صعوبة إنشاء Manager/Editor/Support حسب حاجة العميل | أدوار مخصصة وصلاحيات إضافية مع بقاء RBAC الأساسي fail-closed |
| عالية | Feature Flags لم تكن مرتبطة بالتنفيذ | يمكن أن يظهر المفتاح في اللوحة دون تأثير فعلي | تقييم قواعد البيانات وتطبيق `whatsapp_integration` عند مدخل Webhook |
| متوسطة | الحذف الناعم غير موحد بين كل الموارد | صعوبة الاسترجاع وتباين السلوك | سجل `deleted_items` ومعالجات Restore/Purge صريحة للأنواع المدعومة |
| متوسطة | سجل التدقيق القديم يعتمد على metadata عامة | صعوبة مقارنة التغيير | عمليات Control Plane تحفظ القيم القديمة والجديدة مع actor/resource |
| متوسطة | Email وPush لا يملكان Provider إنتاجيًا | قواعد القناة قد تفشل عند اختيار موفر غير مركب | تسجل كـ`PROVIDER_NOT_CONFIGURED` بدل ادعاء الإرسال؛ يلزم موفر لاحقًا |
| متوسطة | MFA غير موجود في مسار الدخول الحالي | كلمة المرور وحدها لا تكفي للحسابات الحساسة | مطلوب تنفيذ TOTP/WebAuthn كمرحلة أمنية مستقلة قبل إعلان الدعم الإنتاجي |
| منخفضة | تحذيرات React/unused imports قديمة | ضوضاء في CI وصعوبة رؤية مشاكل جديدة | تنظيف تدريجي، وقد أصلح التنقل والقنوات في هذا الفرع |

## المعمارية الجديدة

### Channel Platform

المسار المشترك:

```text
Webhook
  -> Signature validation + body/rate limits
  -> Resolve external account
  -> ChannelConnection
  -> Feature flag + connection status
  -> Idempotent ChannelEvent
  -> Contact identity / internal user link
  -> Agent, provider, workflow and inbox routing
  -> Channel permissions and tool allowlist
  -> Conversation continuation or creation
  -> Agent runtime / human handoff
  -> ChannelAdapter.send
  -> Delivery and audit records
```

العقد المشترك يغطي الرسائل الواردة والصادرة والهوية والمرفقات والتفاعل والتوجيه والصلاحيات والتحويل البشري. لا توجد نسخة مستقلة من Runtime خاصة بواتساب.

### Platform Control Plane

طبقة إضافية فوق الأنظمة الحالية، وليست بديلًا لها:

- `platform_modules`: حالة الوحدة وترتيبها وإخفاؤها وحذفها الناعم.
- `feature_flags`: تشغيل الميزة والتفعيل التدريجي المحدد deterministic rollout.
- `custom_roles` و`custom_role_permissions`: أدوار قابلة للتخصيص.
- `member_custom_roles`: إسناد أدوار متعددة للعضو.
- `platform_settings`: إعدادات Namespaced مع حجب القيم الحساسة عن الاستجابة.
- `deleted_items`: سجل موحد للاسترجاع والحذف النهائي المراقب.

RBAC الأساسي يبقى المصدر الآمن الافتراضي. الصلاحيات المخصصة لا تستطيع إلغاء حماية المالك أو تعديل منطق النظام؛ هي تمنح صلاحيات معروفة فقط من قائمة مغلقة.

### Event-Driven Notifications

```text
Business transaction
  -> publishDomainEvent / API v1 events
  -> domain_events (idempotency key)
  -> Graphile Worker job (deduplicated)
  -> notification_rules
  -> notification_templates
  -> recipient resolver
  -> internal / WhatsApp / future email / future push provider
  -> notification_deliveries
  -> audit log
```

يُمنع نشر حقول تحمل أسماء حساسة مثل password أو token أو secret أو OTP عبر Event API. كما توجد حدود للعمق وعدد الحقول والقوائم وحجم الطلب.

## WhatsApp Business

التنفيذ يستخدم Meta Cloud API الرسمي ويشمل:

- تحقق `X-Hub-Signature-256` بمفتاح التطبيق.
- Verify Token لمسار اشتراك Webhook.
- حدود حجم وRate Limiting لكل رقم.
- Idempotency لأحداث الرسائل.
- نصوص وصور وملفات وصوت وفيديو وردود وأزرار وقوائم وحالة قراءة.
- تنزيل وسائط بمهلة وحد حجم ومنع redirects غير الآمنة.
- Retry محدود للأخطاء العابرة و429 و5xx.
- أخطاء Meta منقحة لا تسرب Access Token.
- ربط رقم WhatsApp باتصال المؤسسة والوكيل والمزود والنموذج والصندوق وسير العمل والأدوات والصلاحيات.
- ربط رقم المرسل بمستخدم داخلي عندما يكون معروفًا، وإلا إنشاء Channel Contact خارجي.
- رسائل Template معتمدة من Meta للإشعارات خارج نافذة المحادثة.

## API الجديدة والموسعة

### Control Plane

- `GET /api/dashboard/control-plane`
- `POST /api/dashboard/control-plane`

عمليات POST الحالية:

- `module.update`
- `feature.update`
- `setting.upsert`
- `role.upsert`
- `role.assign`
- `template.upsert`
- `rule.upsert`
- `trash.restore`
- `trash.purge`

### Domain Events

- `POST /api/v1/events`
- يتطلب Bearer API Key ونطاق `events:write`.
- يدعم `eventKey`, `resourceType`, `resourceId`, `payload`, `occurredAt`, و`idempotencyKey`.

### القنوات

- إدارة الاتصالات.
- ربط الوكلاء والمزودات والأدوات.
- الصلاحيات وقواعد التوجيه.
- الاختبار والحالة والفصل والتحويل البشري.
- Webhooks مشتركة مع Router مركزي.

## الأداء والقابلية للتوسع

- المعالجة الثقيلة خارج دورة Webhook باستخدام `after` وGraphile Worker.
- مفاتيح Job تمنع معالجة الحدث نفسه أكثر من مرة.
- فهارس حسب المؤسسة والحالة ووقت الجدولة في جداول Control Plane والإشعارات.
- عمليات القراءة الإدارية تنفذ بالتوازي عبر `Promise.all` وتضع حدودًا لسجلات التسليم وسلة المحذوفات.
- Feature rollout لا يحتاج استعلامًا عشوائيًا أو حالة خارجية؛ النتيجة ثابتة لكل subject.
- Webhook يعيد قبولًا سريعًا ثم ينفذ التوجيه في مهمة لاحقة ضمن دورة Next.js المضمونة.
- Router يستخدم المحادثة الحالية بدل إنشاء محادثة لكل رسالة.

## الحماية

- كل Mutation في لوحة التحكم يتحقق من Same Origin.
- Rate Limits مستقلة للمصادقة وControl Plane وEvent API وWebhook.
- كل استعلام إداري يقيّد `organization_id`.
- القيم الحساسة في Settings لا تعاد للعميل.
- الأسرار تبقى مشفرة ولا تخزن داخل قوالب الإشعارات أو Audit metadata.
- العمليات المالية والحساسة محظورة افتراضيًا في سياسة القناة.
- Permanent delete لا يستخدم Handler عام؛ يجب تعريف معالج صريح لكل Resource Type.
- Webhook يقبل JSON فقط ضمن حد الحجم، ويتحقق من التوقيع قبل parsing والمعالجة.

## ما لا ينبغي ادعاء اكتماله

- المشروع لا يحتوي حاليًا على Payments/Orders domain كامل؛ Event API يدعم أحداثه عندما تُضاف الوحدة أو تربط خدمة خارجية، لكنه لا ينشئ نظام طلبات أو مدفوعات وهميًا.
- Email وPush موجودان كقنوات تعاقدية في Notification Center، لكنهما يحتاجان Provider فعليًا وأسرارًا وتشغيلًا منفصلًا قبل التفعيل.
- MFA يحتاج مسار إعداد وتحدي واسترجاع واختبارات أمان قبل الإعلان عنه كميزة إنتاجية.
- تعميم `deleted_items` على كل جدول قديم يجب أن يتم Resource-by-Resource لتجنب كسر علاقات Foreign Keys.

## بوابة الإطلاق

لا تُدمج التغييرات ما لم تنجح:

1. `npm audit --omit=dev --audit-level=high`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run test:e2e`
6. `npm run build`
7. `npm run db:migrate:all` على PostgreSQL فارغ
8. اختبارات التكامل
9. Docker Compose smoke وWorker health
10. اختبار WhatsApp حقيقي في بيئة Meta Test Number أو رقم Business منخفض الصلاحيات

## خطوات تشغيل يدوية

- تطبيق migrations 0032 و0033 و0034 في مرحلة pre-deploy.
- ضبط متغيرات Meta وWebhook URL وVerify Token في بيئة الإنتاج.
- اعتماد قوالب WhatsApp المطلوبة داخل WhatsApp Manager ثم إدخال أسمائها في Template Manager.
- إنشاء API Key بنطاق `events:write` للخدمات التي تبث أحداث الموقع.
- إبقاء قوالب الطلبات والمدفوعات معطلة حتى توجد وحدة أعمال فعلية ومصدر موثوق للأحداث.
- مراقبة `notification_deliveries`, `channel_events`, `audit_logs`, وWorker heartbeat بعد الإطلاق.
