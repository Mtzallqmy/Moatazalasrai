# سجل التدقيق الكامل للمنصة

تاريخ التدقيق: 2026-08-01. النطاق: الشجرة الكاملة في commit `b97f179`، مسارات Next.js، مخطط Drizzle و20 migration، AI SDK وMCP وGraphile Worker، Flutter، Docker وRailway وGitHub Actions. مصدر الحقيقة هو الكود والاختبارات والبناء.

## خط الأساس

| الأمر | النتيجة قبل الإصلاح |
|---|---|
| `node --version` | `v24.14.0`؛ غير مطابق لنسخة CI `22.18.0` |
| `npm ci` | نجح بعد نقل cache إلى `/tmp`؛ محاولة البيئة الأولى فشلت لأن `/root/.npm` غير قابل للكتابة |
| `npm run lint` | نجح مع تحذير unused import في `src/ai/mcp/execution.ts` |
| `npm run typecheck` | نجح |
| `npm test` | 127 ناجح، 13 PostgreSQL متخطى |
| `npm run test:integration` | 7 ناجحة، 12 PostgreSQL متخطاة لغياب `TEST_DATABASE_URL` |
| `npm run test:e2e` | اختباران متخطيان لغياب `E2E_BASE_URL` واعتماد live اختياري |
| `npm run build` | نجح مع تحذيرين عن `process.once` داخل Edge bundle |
| Flutter / Docker / PostgreSQL | الأدوات غير مثبتة في بيئة التدقيق؛ لم يُدّع نجاحها |

## P0

لم يثبت في الفحص الحالي مسار P0 قابل للاستغلال دون افتراضات خارج المستودع.

## P1

### AUD-P1-001 — تدوير Refresh Token غير ذري

- المكوّن: `src/lib/auth/mobile.ts`, `rotateMobileSession`.
- الدليل: كان الاستعلام يقرأ الرمز ثم يحدثه دون فحص نتيجة `UPDATE` الشرطي.
- الفشل: طلبان متزامنان قد يعيدان مجموعتي رموز، إحداهما غير صالحة، دون كشف إعادة الاستخدام.
- الأثر: سباق جلسة، سلوك غير حتمي، وإضعاف reuse detection.
- السبب: تجاهل صفوف `RETURNING`.
- الإصلاح: update compare-and-swap مع `revoked_at IS NULL` وخطأ ثابت `REFRESH_TOKEN_REUSED`.
- الاختبار: حالة تزامن PostgreSQL في `tests/integration/worker-postgres.test.ts`.
- الحالة: منفذ؛ ينتظر تشغيل الاختبار في CI ذي PostgreSQL.

### AUD-P1-002 — عدم تدوير جلسة الويب عند تبديل المؤسسة

- المكوّن: `src/lib/auth/session.ts`, `setActiveOrganization/currentSession`.
- الدليل: كان التبديل يغير `active_organization_id` فقط ويحافظ على token نفسه، ولا يوجد idle expiry.
- الفشل: استمرار token ثابت عبر انتقال trust boundary وبقاء جلسة خاملة حتى الانتهاء المطلق.
- الأثر: توسيع نافذة اختطاف الجلسة.
- السبب: غياب rotation وسياسة خمول.
- الإصلاح: token جديد ذريًا عند التبديل، Cookie آمن بنفس الانتهاء المطلق، وخمول أقصى 7 أيام.
- الاختبار: E2E auth contract الحالي، وفحص البناء/typecheck؛ يلزم تشغيل E2E في البيئة المعزولة.
- الحالة: منفذ.

### AUD-P1-003 — تشفير دون key ID أو AAD أو مسار تدوير

- المكوّن: `src/lib/security/encryption.ts` وكل مخازن المزودات والتكاملات وMCP والموافقات/checkpoints.
- الدليل: envelope `v1` احتوى IV/tag/ciphertext فقط واستخدم مفتاحًا وحيدًا.
- الفشل: تعذر تدوير آمن، وإمكانية نقل ciphertext صحيح إلى سياق آخر.
- الأثر: توقف عند تدوير المفتاح وضعف ربط السر بالمؤسسة/المورد.
- السبب: صيغة envelope أحادية المفتاح.
- الإصلاح: `v2.<keyId>`، AAD سياقي، keyring للقراءة، تحقق صارم، أداة re-encryption ذرية وقابلة للاستئناف، وإبقاء قراءة v1.
- الاختبار: `tests/security.test.ts` يغطي nonce والتلاعب والسياق والمفتاح السابق وv1.
- الحالة: منفذ.

### AUD-P1-004 — مسار HTTP للتكاملات يتجاوز حاجز SSRF

- المكوّن: `src/lib/integrations/http.ts`.
- الدليل: كان يستدعي `fetch(url)` مباشرة، بينما حاجز DNS/IP موجود فقط لمسارات المزود.
- الفشل: adapter قابل للتهيئة قد يصل إلى loopback أو metadata.
- الأثر: قراءة خدمات داخلية بحسب adapter المستخدم.
- السبب: عدم توحيد outbound validation.
- الإصلاح: تمرير كل طلب عبر `validateProviderBaseUrl`، منع redirects، timeout، والحفاظ على خطأ الرفض الأمني.
- الاختبار: `tests/integrations-foundation.test.ts` يثبت رفض `127.0.0.1` قبل الاتصال.
- الحالة: منفذ. يبقى DNS pinning أثناء الاتصال تحسين دفاع معمق موثق في Threat Model.

### AUD-P1-005 — CSP يسمح بالسكريبت inline

- المكوّن: `next.config.mjs`, `src/proxy.ts`, `src/app/layout.tsx`.
- الدليل: `script-src 'unsafe-inline'` في جميع البيئات.
- الفشل: خفض أثر CSP أمام XSS.
- الأثر: تنفيذ inline script عند وجود sink مستقل.
- السبب: theme bootstrap بلا nonce.
- الإصلاح: nonce فريد لكل طلب، `strict-dynamic`، `unsafe-eval` للتطوير فقط، وعدم تكرار CSP في رأسين متعارضين.
- الاختبار: `tests/http.test.ts` يتحقق من CSP وعدم `unsafe-inline` للسكريبت.
- الحالة: منفذ. بقي `style-src 'unsafe-inline'` مؤقتًا لتوافق Tailwind/React ويجب إزالته تدريجيًا.

### AUD-P1-006 — إصدار Android قد يُنشر بتوقيع debug

- المكوّن: `apps/mobile/android/app/build.gradle.kts`, `.github/workflows/android-release.yml`.
- الدليل: fallback صريح إلى `signingConfigs.debug` مع استمرار إنشاء GitHub Release.
- الفشل: نشر artifact غير موثوق كتحديث إنتاجي.
- الأثر: كسر سلسلة الثقة والتحديث.
- السبب: تفضيل نجاح build على fail-closed.
- الإصلاح: release يتطلب keystore؛ debug signing لا يعمل إلا بعلم صريح في CI غير الناشر.
- الاختبار: مراجعة workflow وGradle، وAndroid CI يبني فقط مع `ALLOW_DEBUG_RELEASE_SIGNING=true`.
- الحالة: منفذ؛ بناء Flutter المحلي غير متاح في بيئة التدقيق.

### AUD-P1-007 — صلاحيات مفاتيح المنصة الفارغة تعني صلاحية كاملة ضمنيًا

- المكوّن: `src/lib/auth/api-key.ts`, bootstrap، migration `0020`.
- الدليل: `key.scopes.length ? key.scopes : [all scopes]`.
- الفشل: مفتاح قديم أو منشأ خطأً بقائمة فارغة يحصل على إدارة كاملة.
- الأثر: تصعيد صلاحيات داخل المؤسسة.
- السبب: دلالة legacy غير fail-closed.
- الإصلاح: backfill صريح متوافق للمفاتيح الحالية، ثم القائمة الفارغة بلا صلاحية؛ bootstrap يكتب scopes كاملة صراحة وتُرفض القيم المجهولة.
- الاختبار: `tests/security.test.ts` و`tests/integrations-foundation.test.ts`.
- الحالة: منفذ؛ يجب نشر migration قبل web.

### AUD-P1-008 — GitHub Actions غير مثبتة على commit

- المكوّن: workflows الأربعة.
- الدليل: `uses: ...@v2/v4/v5/v6` tags قابلة للتحريك.
- الفشل: تغير action upstream دون مراجعة repository diff.
- الأثر: خطر سلسلة توريد داخل CI/release.
- السبب: الاعتماد على tags.
- الإصلاح: تثبيت كل action على SHA مع تعليق الإصدار، وإضافة `npm audit --omit=dev --audit-level=high`.
- الاختبار: lint YAML بصريًا و`rg 'uses:.*@v' .github/workflows` يجب ألا يعيد نتائج.
- الحالة: منفذ.

## P2

### AUD-P2-001 — إصدار Node غير موحد

- المكوّن: `package.json`, Docker, CI والوثائق.
- الدليل: engine كان `>=22.18.0`، Docker `node:22-alpine`، CI `22.18.0`.
- الفشل: اختلاف runtime/build واعتماد سلوك إصدار أحدث دون قصد.
- الأثر: builds غير قابلة للتكرار.
- السبب: ranges وصور غير مثبتة minor.
- الإصلاح: `22.18.0` في engine و`.nvmrc` وDocker وCI.
- الاختبار: build وlockfile verification.
- الحالة: منفذ؛ بيئة التدقيق نفسها بقيت Node 24.

### AUD-P2-002 — تحذير Edge في instrumentation

- المكوّن: `src/instrumentation.ts`.
- الدليل: build أبلغ عن `process.once` غير مدعوم في Edge.
- الفشل: ضوضاء build واحتمال bundle غير متوافق.
- الأثر: تشخيص أقل موثوقية.
- السبب: import ثابت لكود Node.
- الإصلاح: dynamic import بعد حارس runtime ونقل signal hooks إلى Node module.
- الاختبار: `npm run build` دون التحذير السابق.
- الحالة: منفذ.

### AUD-P2-003 — اختبارات قبول تعتمد على خدمات غير متاحة محليًا

- المكوّن: PostgreSQL integration، Playwright، Flutter، Docker.
- الدليل: 14 اختبارًا متخطى حاليًا والأدوات غير مثبتة.
- الفشل: تغيرات DB/Flutter لا تُثبت في محطة المطور الحالية.
- الأثر: تأخر اكتشاف regressions.
- السبب: غياب toolchain والخدمات في بيئة التدقيق.
- الإصلاح: CI PostgreSQL وAndroid موجودان؛ يلزم إضافة بيئة E2E معزولة وcontainer scanning/SBOM في متابعة تشغيلية.
- الاختبار: أوامر القبول في CI.
- الحالة: مفتوح ومبرر بغياب الخدمات؛ الإجراء التالي موضح في Runbook.

## P3

- إزالة `style-src 'unsafe-inline'` بعد تحويل الأنماط الديناميكية إلى classes/nonces.
- استبدال pagination المعتمد على OFFSET في القوائم الكبيرة بـcursor بعد قياس أحجام الإنتاج.
- إضافة malware scanner فعلي خلف adapter؛ لا توجد خدمة فحص مهيأة حاليًا، ولذلك لا تعرض المنصة ادعاء فحص.
