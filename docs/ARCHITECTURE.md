# المعمارية

## الحدود العامة

التطبيق خدمة Next.js واحدة حتى لا تُضاف بنية موزعة غير مستخدمة. المسارات والواجهات في `src/app`، منطق المجال في `src/lib`، ومخطط PostgreSQL في `src/db/schema.ts`.

```mermaid
flowchart TD
  UI["واجهة RTL"] --> API["Route Handlers"]
  API --> AUTH["جلسة + RBAC + Zod + CSRF"]
  AUTH --> SERVICES["خدمات المجال"]
  SERVICES --> DB["Drizzle / PostgreSQL"]
  SERVICES --> ADAPTERS["Provider Adapters"]
  ADAPTERS --> PROVIDERS["OpenAI / Anthropic / Gemini / Compatible"]
```

## الطبقات

- Route Handlers: request ID، المصادقة، permission، CSRF، rate limit، parsing وحدود body، وتحويل النتيجة إلى عقد API موحد.
- خدمات المجال: الوكلاء والإصدارات، المحادثة، تجهيز سياق النموذج، دورة التشغيل، الإلغاء، الأحداث والتدقيق.
- Provider Adapters: `discoverModels`, `testModel`, `generate`, `stream`, `normalizeError`, `normalizeUsage`, `abort` والقدرات.
- طبقة البيانات: Drizzle مع قيود وفهارس وعلاقات، وكل استعلام tenant-owned مقيد بالمؤسسة المشتقة من الجلسة أو API key.

## المصادقة والمؤسسة النشطة

قاعدة البيانات تخزن hash لجلسة عشوائية، بينما Cookie تحمل القيمة الأصلية كـ`HttpOnly`. كل جلسة تخزن `activeOrganizationId`. عند عضوية واحدة يمكن اختيارها حتميًا؛ عند عدة عضويات يختار المستخدم صراحة ولا تُستخدم أول عضوية عشوائيًا.

## الوكلاء والإصدارات

سجل `agents` يحتفظ بالحالة ورقم الإصدار الحالي. كل تغيير في إعدادات Runtime أو نشر جديد ينشئ صفًا جديدًا ثابتًا في `agent_versions`. التشغيل يقبل الوكلاء المنشورين فقط ويتحقق من أن المزود مفعّل ونجح آخر فحص.

## المحادثة والتشغيل

رسالة المستخدم تُحفظ أولًا. يبنى السياق من الرسائل الأخيرة بميزانية تقديرية ويضاف system instruction على الخادم فقط. ينشأ Run في `queued` ثم `running`. أحداث مهمة فقط تُحفظ؛ لا يكتب كل token إلى قاعدة البيانات. بعد اكتمال البث تُحفظ رسالة المساعد والـusage والنتيجة داخل transaction.

## الاعتمادية

- اتصالات المزودات بدون cache أو redirects.
- DNS validation قبل كل اتصال لتقليل DNS rebinding.
- timeout وحد أقصى لحجم JSON والبث.
- retry محدود فقط لـ408/429/5xx والأخطاء الشبكية.
- circuit cooldown بعد إخفاقات متتالية.
- Pagination للقوائم المتنامية.
- لا اتصال بقاعدة البيانات ولا migration أثناء `next build`.

## Runtime

المصادقة والتشفير وDNS والمزودات تعمل على Node runtime. لا تدعي المسارات التي تستخدم `node:crypto` و`node:dns` أنها Edge-native. Docker/Railway هو مسار النشر الأساسي.
