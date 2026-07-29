# منصة معتز للوكلاء الذكيين

منصة SaaS عربية، متعددة المؤسسات، لبناء وكلاء ذكاء اصطناعي وتشغيلهم باستخدام مفاتيح المستخدم (BYOK). المشروع مبني على Next.js App Router وReact وTypeScript وTailwind وDrizzle وPostgreSQL، ومسار النشر الإنتاجي مهيأ لـRailway.

لا يتضمن المشروع دفعًا أو اشتراكات أو أسعارًا أو فوترة.

## ما يعمل فعليًا

- تسجيل حساب ومؤسسة، تسجيل الدخول والخروج، جلسات مخزنة كـhash داخل PostgreSQL، واختيار مؤسسة نشطة عند تعدد العضويات.
- RBAC من الباكند للأدوار: `owner` و`admin` و`developer` و`operator` و`viewer`.
- إدارة أعضاء المؤسسة للمستخدمين المسجلين، دون دعوات بريد وهمية.
- اتصالات OpenAI وAnthropic وGemini وOpenAI-compatible عبر Adapters موحدة.
- فحص DNS/TLS والاعتماد ومسار النماذج، ثم اختبار توليد حقيقي لنموذج قبل حفظ المزود كـ`verified`.
- حماية SSRF للمزود المخصص، مهلات، منع redirects، حدود للاستجابة، أخطاء منقحة، ومحاولات محدودة للأعطال المؤقتة.
- تشفير مفاتيح المزودات باستخدام AES-256-GCM داخل envelope بإصدار وnonce عشوائي وauthentication tag.
- إنشاء الوكلاء وإصدارات ثابتة، نشر/أرشفة/استعادة، واختيار نموذج مكتشف فعليًا.
- محادثات محفوظة، سياق سابق بميزانية Tokens تقديرية، Streaming، إيقاف، إعادة محاولة، إعادة تسمية، أرشفة وحذف.
- دورة تشغيل `queued → running → completed / failed / cancelled` وأحداث فعلية ومعرّفات طلب واستهلاك Tokens عندما يوفره المزود.
- لوحة عربية RTL متجاوبة للمزودات والوكلاء والمحادثات والتشغيل والأعضاء والتدقيق والإعدادات والتشخيص.
- نظام تصميم جديد هادئ بواجهة فاتحة ووضع داكن، لوحة كثيفة للمؤشرات، Sidebar ثابت لسطح المكتب وDrawer حقيقي للهاتف، وخط Noto Sans Arabic مضمّن محليًا.
- فرق وكلاء حقيقية: عمال يعملون بالتوازي ثم وكيل مشرف يقرأ نواتجهم ويولّف النتيجة، مع حفظ الفريق والتشغيل وكل خطوة في PostgreSQL.
- بوابة MCP حقيقية مبنية على SDK الرسمي عبر Streamable HTTP: إضافة الخوادم، اكتشاف الأدوات، مزامنة مخططاتها، تنفيذها، وحفظ سجل الاستدعاء والمدة والأخطاء.
- تطبيق Flutter أصلي داخل `apps/mobile` لا يستخدم WebView؛ يسجل الدخول بجلسة جهاز قصيرة، يخزن الرموز في Android Keystore، ويستهلك REST API للمؤشرات والمحادثات.
- Health وreadiness منفصلان، Security headers، CSRF/Origin checks، rate limits مخزنة، ورسائل API موحدة.
- تكامل Telegram عبر Webhook موثّق، ربط كل محادثة بالوكيل، أوامر `/new` و`/status` و`/github repos`، ومعالجة خلفية تمنع تعطيل استقبال التحديثات.
- تكامل GitHub بتوكن مشفّر للتحقق وعرض المستودعات وقراءة الملفات عبر API مضبوط المسارات.
- رفع ملفات حقيقي داخل الدردشة وAPI حتى 10MB مع metadata وSHA-256 وعزل كامل بين المؤسسات.
- ظهور المرفقات داخل سجل الرسالة بعد إعادة التحميل، وتمرير النص المفهرس للنموذج، وإرسال الصور كمدخلات multimodal حقيقية للمزودات الداعمة ولـTelegram وAPI v1.
- API إصدار `v1` للدردشة والمحادثات والملفات والتكاملات وGitHub، مع عقد OpenAPI تمهيدًا لتطبيق Android أصلي.
- توسعة اختيارية خلف Feature Flags للذاكرة المعزولة، وقواعد المعرفة والاستشهادات، والأدوات بموافقات بشرية، وWorker مستقل بصف ذري.
- مكتبة وكلاء جاهزة بثمانية تخصصات مع إنشاء فعلي وإصدار محفوظ، ودور `member` آمن للمستخدمين الجدد دون صلاحيات الإدارة.

## المتطلبات

- Node.js 20.11 أو أحدث.
- خدمة PostgreSQL داخل مشروع Railway نفسه.
- مفتاح تشفير 32 بايت بصيغة Base64.

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

التطبيق: `http://localhost:3000`

## متغيرات البيئة

| المتغير | مطلوب | الاستخدام |
|---|---:|---|
| `DATABASE_URL` | نعم | مرجع اتصال PostgreSQL الذي يحقنه Railway وقت التشغيل، ولا يُستخدم أثناء build |
| `CREDENTIAL_ENCRYPTION_KEY` | نعم | مفتاح Base64 بطول 32 بايت لتشفير مفاتيح المزودات |
| `APP_URL` | في الإنتاج | أصل HTTPS الموثوق لحماية CSRF |
| `BOOTSTRAP_ADMIN_TOKEN` | اختياري | تهيئة API للمنصة مرة واحدة؛ التسجيل العادي لا يحتاجه |
| `LOG_LEVEL` | لا | `debug` أو `info` أو `warn` أو `error` |
| `TEST_DATABASE_URL` | للاختبار التكاملي | قاعدة اختبار منفصلة جرى تطبيق migrations عليها |
| `E2E_BASE_URL` | لـE2E | نشر اختبار مستقل |
| `E2E_PROVIDER_*` | للاختبار الحي فقط | أسرار مزود اختبار مخصصة، ولا توضع في المستودع |
| `AI_MEMORY_ENABLED` / `AI_RAG_ENABLED` / `AI_TOOLS_ENABLED` | لا | تفعيل تدريجي بعد migration |
| `AI_WORKER_ENABLED` | لخدمة Worker | يفعّل في Worker فقط |
| `JOB_*` | لا | polling وlock timeout والمحاولات وحجم الدفعة |

توليد مفتاح التشفير:

```bash
openssl rand -base64 32
```

لا تغيّر `CREDENTIAL_ENCRYPTION_KEY` بعد حفظ مزودات دون خطة لإعادة تشفير الأسرار.

## قاعدة البيانات

`src/db/schema.ts` هو مخطط Drizzle المرجعي، و`drizzle/` يحتوي سجل migrations. التطبيق لا يشغّل migrations مع طلبات HTTP أو عند بدء كل replica.

```bash
npm run db:generate
npm run db:migrate
npm run db:studio
```

الجداول الأساسية: `users`, `sessions`, `mobile_sessions`, `organizations`, `organization_members`, `provider_credentials`, `agents`, `agent_versions`, `conversations`, `messages`, `runs`, `run_events`, `platform_api_keys`, `audit_logs`, `rate_limits`.

جداول التكامل والتخزين: `integrations`, `telegram_chats`, `telegram_updates`, `attachments`.

جداول MCP والفرق: `mcp_servers`, `mcp_tools`, `agent_mcp_tools`, `mcp_tool_calls`, `agent_teams`, `agent_team_members`, `agent_team_runs`, `agent_team_run_steps`.

جداول التوسعة: `agent_memories`, `knowledge_bases`, `knowledge_documents`, `knowledge_chunks`, `background_jobs`, `tool_approvals`.

## Telegram وGitHub

من لوحة التحكم افتح **التكاملات والأدوات**. أدخل Bot Token أو GitHub fine-grained token؛ يتحقق الخادم منه قبل تشفيره ولا يعيده إلى الواجهة. يتطلب Telegram أن يكون `APP_URL` مضبوطًا على رابط HTTPS العام في Railway، ثم يُفعّل Webhook تلقائيًا.

استخدم أقل صلاحيات ممكنة لتوكن GitHub. الواجهة الحالية تسمح بعرض المستودعات وقراءة الملفات فقط؛ لا توجد عمليات حذف أو force-push.

## API لتطبيق Android

عقد OpenAPI متاح في `/api/v1/openapi`. التطبيق الأصلي لا يحتوي مفتاح منصة ثابتًا؛ يبدأ من:

```http
POST /api/mobile/v1/auth/login
POST /api/mobile/v1/auth/refresh
Authorization: Bearer mat_<SHORT_LIVED_ACCESS_TOKEN>
```

وتظل مفاتيح المنصة ذات النطاقات متاحة للتكاملات الخادمية. المسارات الأساسية: `/api/v1/agents`, `/api/v1/conversations`, `/api/v1/chat`, `/api/v1/files`, `/api/v1/runs`, `/api/v1/teams`, `/api/v1/team-runs`, `/api/v1/integrations`, `/api/v1/github`.

تطبيق Flutter:

```bash
cd apps/mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=https://your-domain.example
```

راجع [دليل تطبيق Android](apps/mobile/README.md) و[دليل API](docs/API.md).

## التحقق قبل الدمج

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

اختبارات E2E تتخطى التنفيذ ما لم يُضبط `E2E_BASE_URL`. اختبار المزود الحي يتطلب أسرار `E2E_PROVIDER_*` مخصصة. لا توجد مفاتيح مزود داخل الاختبارات.

## النشر

المسار الأساسي هو Docker/Railway مع Node runtime. يشغّل Railway migrations تلقائيًا قبل الإصدار، ثم يبدأ التطبيق ويفحص:

- `/api/health`: liveness دون اتصال عميق بالخدمات.
- `/api/ready`: جاهزية قاعدة البيانات والمخطط.

راجع [دليل النشر](docs/DEPLOYMENT.md).

## وثائق المشروع

- [المعمارية](docs/ARCHITECTURE.md)
- [الأمان](docs/SECURITY.md)
- [المصادقة والمؤسسات](docs/AUTHENTICATION.md)
- [واجهات API](docs/API.md)
- [خريطة الواجهة إلى الباكند](docs/UI_BACKEND_MAP.md)
- [التدقيق والقيود](docs/CURRENT_STATE_AUDIT.md)
- [تقرير التسليم والتحقق](docs/DELIVERY_REPORT.md)

## قيود حقيقية

- لا توجد استعادة كلمة مرور أو تأكيد بريد أو دعوات بريد قبل إعداد مزود بريد حقيقي.
- لا يوجد دفع أو اشتراك أو فوترة.
- إيقاف Streaming يستخدم `AbortController` ويكون فوريًا داخل instance نفسه؛ تشغيل عدة replicas يحتاج قناة إلغاء مشتركة.
- تشغيل فرق الوكلاء ينفذ حاليًا داخل طلب API مع تخزين كامل للخطوات؛ الأحمال الطويلة جدًا تحتاج نقل المنفذ إلى Worker.
- بوابة MCP تنفذ الاتصال والاكتشاف والاستدعاء فعليًا، أما منح أداة لوكيل فيظهر في مخطط البيانات ولا يُدخل الأداة تلقائيًا في حلقة provider tool-calling قبل إضافة سياسة موافقات مناسبة.
- ميزانية السياق تقديرية لأن حدود النماذج تختلف؛ لا يتم اختلاق usage عند غيابها من المزود.
- معالجة وثائق المعرفة تعمل في Worker مستقل؛ تشغيل النموذج المتدفق يبقى في Web للمحافظة على البث.
- دعم النشر لا يعني أن نشرًا إنتاجيًا حيًا تم إجراؤه. راجع نتائج التحقق الفعلية في تقرير التسليم.

## الرخصة

MIT
