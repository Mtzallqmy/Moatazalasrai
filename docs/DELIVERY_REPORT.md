# تقرير التسليم والتحقق

## إصدار 2026-08-03: واجهة الإنتاج والتكاملات

الفرع المحلي: `feature/production-ui-rebuild`

### نطاق الإصدار

- تكامل WhatsApp Business Platform الرسمي عبر Cloud API في migration `0028`.
- إصلاح ثبات Puter E2E وتجهيز Gradle Wrapper داخل CI دون إضافة ملفات مولدة غير لازمة.
- إعادة بناء App Shell ونظام التصميم والتنقل المتجاوب وRTL.
- طبقة API client موحدة وأخطاء عربية آمنة وrequest IDs وtimeouts.
- محادثة حقيقية مرتبطة بـPostgreSQL وSSE، ومسودات خادمية في migration `0029`.
- عضويات محادثة فعلية بأدوار قارئ/كاتب/مدير ومؤلف الرسالة في migration `0030`.
- واجهات فعلية للملفات والمعرفة وتصفح GitHub وRuns والوكلاء والنماذج، وفق العقود الموجودة فقط.

### commits المحلية

```text
0052d3d test(docs): cover conversation access and delivery state
777ed84 feat(chat): add real conversation membership and authorship
15d2048 feat(ui): rebuild production workspace experience
606da13 fix(ci): stabilize Puter E2E and bootstrap Android wrapper
53ca6cb feat(integrations): add official WhatsApp Cloud API account linking
```

### نتائج الأوامر الفعلية

| الفحص | النتيجة الفعلية |
|---|---|
| Install | فشل `npm ci` قبل التثبيت بسبب HTTP 404 من مرآة npm الداخلية للحزمة `zod-validation-error@4.0.2`؛ البيئة تستخدم Node 22.16.0 والمشروع يطلب 22.18.0. |
| Typecheck | شُغّل، لكنه فشل بسبب غياب dependencies بعد فشل install؛ لا يُعد نتيجة على صحة الأنواع في الكود. |
| Lint | لم يبدأ lint؛ `eslint` المحلي غير مثبت. |
| Unit | لم تبدأ الاختبارات؛ `vitest` المحلي غير مثبت. |
| Integration | لم تبدأ الاختبارات؛ `vitest` غير مثبت ولا يوجد `TEST_DATABASE_URL`. |
| E2E | لم يبدأ Playwright الخاص بالمشروع لغياب الحزمة المحلية. |
| Build | لم يبدأ Next build؛ `next` المحلي غير مثبت. |
| فحص patch | نجح `git diff --check`. |
| فحص syntax | نجح transpile نحوي لـ64 ملف TypeScript/TSX متغيرًا. |
| migrations | نجح parser للمigrations 0027–0030. |
| workflows/scripts | نجح تحليل 3 ملفات YAML و`bash -n` للسكريبتات المتغيرة. |

### حالة Git

تعذر النشر من بيئة التنفيذ: موصل GitHub عُطّل عند الاستدعاء الفعلي، و`git ls-remote` فشل برسالة `Could not resolve host: github.com`، كما أن `gh` غير مثبت. لذلك لا يوجد ادعاء بأن الفرع أو commits أو PR رُفعت إلى GitHub.

### نواقص موثقة

- presence/typing الحي يحتاج خدمة realtime وجداول أو قناة أحداث.
- فهرسة المستودعات وcheckpoints وcitations على مستوى السطر تحتاج jobs ومخططًا إضافيًا.
- مشاركة المحادثة العامة وfork تحتاج عقود صلاحيات وروابط قصيرة العمر.
- URL knowledge sources وإصدارات الملفات وهوية الوكيل الغنية ليست مدعومة بالكامل في المخطط الحالي.
- الاختبارات الحية تحتاج Node 22.18.0، registry صالحًا، PostgreSQL اختباريًا وبيانات اعتماد منفصلة للخدمات.

---

## التقرير التاريخي السابق — 2026-07-29

تاريخ التحقق: 2026-07-29

## النتيجة

هذا الإصدار يعيد بناء المنصة كمنتج عربي متعدد المؤسسات قابل للنشر على Railway،
ويضيف واجهة جديدة، تطبيق Flutter أصلي، جلسات هاتف، بوابة MCP، وفرق وكلاء
متعددة. لا توجد بيانات واجهة ثابتة بديلة عن الباكند في المسارات الجديدة؛
المؤشرات والقوائم تستعلم PostgreSQL، والتشغيل يستدعي مزود النموذج المحفوظ.

## ما تغير في هذا الإصدار

| المجال | التنفيذ |
|---|---|
| تجربة الاستخدام | لوحة كثيفة واضحة، ألوان Ink/Electric Blue، وضع داكن، خط عربي محلي، Sidebar مكتبي وDrawer هاتف |
| تطبيق Android | مشروع Flutter داخل `apps/mobile`، بلا WebView، REST + Dio + Riverpod + تخزين آمن |
| مصادقة الهاتف | Access Token لمدة 15 دقيقة، Refresh Token دوّار لمدة 30 يومًا، hash فقط في PostgreSQL، وربط بالجهاز والمؤسسة |
| API | نطاقات وصول، عزل محادثات وتشغيلات مستخدم الهاتف، OpenAPI 3.1 بعمليات ومعرفات واضحة |
| MCP | SDK الرسمي، Streamable HTTP، اكتشاف الأدوات ومزامنتها واستدعاؤها وسجل دائم |
| فرق الوكلاء | عمال متوازون ثم مشرف للتوليف، مع فرق وتشغيلات وخطوات محفوظة |
| قاعدة البيانات | migration رقم `0009` للجلسات وMCP والفرق والنطاقات |

## الملفات الرئيسية

| المجال | الملفات |
|---|---|
| واجهة الويب | `src/app/dashboard/page.tsx`, `src/components/dashboard-navigation.tsx`, `src/app/globals.css` |
| الهاتف | `apps/mobile/lib`, `apps/mobile/android`, `apps/mobile/README.md` |
| الجلسات والنطاقات | `src/lib/auth/mobile.ts`, `src/lib/auth/api-key.ts`, `src/app/api/mobile/v1` |
| OpenAPI | `src/app/api/v1/openapi/route.ts` |
| MCP | `src/ai/mcp`, `src/app/api/dashboard/mcp`, `src/components/mcp-manager.tsx` |
| فرق الوكلاء | `src/lib/agents/team-runtime.ts`, `src/app/api/v1/teams`, `src/app/api/v1/team-runs` |
| البيانات | `src/db/schema.ts`, `drizzle/0009_mobile_mcp_agent_teams.sql` |

## نتائج التحقق

| الفحص | النتيجة |
|---|---|
| `npm run lint` | نجح بلا أخطاء |
| `npm run typecheck` | نجح بلا أخطاء |
| `npm test` | 18 ملفًا نجح، 74 اختبارًا نجح، واختبار تكامل واحد تخطى |
| `npm run build` | نجح؛ 62 صفحة ومسار API |
| `npm run test:e2e` | الأمر نجح؛ سيناريوهان تخطيا لغياب قاعدة ومزود اختبار حي |
| تطبيق Flutter | فحص مصدر ومخطط Android فقط؛ Flutter SDK غير متاح في بيئة التسليم |
| PostgreSQL حي | لم يُشغل؛ `TEST_DATABASE_URL` غير موفر |
| مزود AI أو MCP حي | لم يُستدعَ لأن بيانات اعتماد اختبار منفصلة غير موفرة |
| نشر Railway | لم يُنفذ؛ التسليم ملف بديل جاهز للرفع |

## ترقية Railway

1. ارفع محتوى المشروع بديلًا عن المستودع السابق.
2. احتفظ بمتغيرات `DATABASE_URL`, `CREDENTIAL_ENCRYPTION_KEY`, `APP_URL`.
3. Railway يشغل `npm run db:migrate` من `preDeployCommand` ويطبق `0009` مرة
   واحدة ثم يبني الحاوية.
4. تحقق من `/api/ready` ثم اختبر تسجيل الدخول.
5. أضف خادم MCP من **MCP والبروتوكولات**، واستخدم رابط HTTPS عامًا يدعم
   Streamable HTTP.

لا تعدل migration سبق تطبيقها؛ نظام migration يتحقق من checksum.

## بناء Android

```bash
cd apps/mobile
flutter pub get
flutter build apk --release \
  --dart-define=API_BASE_URL=https://moatazalalqami.online
```

قبل متجر Google Play أنشئ مفتاح توقيع Release واستبدل إعداد توقيع Debug
الموضح في `apps/mobile/android/app/build.gradle.kts`.

## الحدود المتبقية بوضوح

- تشغيل الفريق متزامن داخل طلب API؛ نقل تشغيلات الفرق الطويلة إلى Worker خطوة
  التوسع التالية.
- ربط أدوات MCP بالوكلاء ممثل في قاعدة البيانات، لكن حلقة استدعاء أدوات النموذج
  التلقائية غير مفعلة حتى لا تنفذ أداة خارجية دون سياسة موافقة وحدود استدعاء.
- لا توجد استعادة كلمة مرور أو بريد دعوات قبل إعداد مزود بريد حقيقي.
- لا يمكن اعتبار نجاح build بديلًا عن اختبار قبول حي ضد قاعدة Railway ومزود
  ذكاء اصطناعي وخادم MCP ببيانات اعتماد اختبار.
