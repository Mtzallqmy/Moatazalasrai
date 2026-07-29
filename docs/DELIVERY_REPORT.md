# تقرير التسليم والتحقق

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
  --dart-define=API_BASE_URL=https://your-domain.example
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
