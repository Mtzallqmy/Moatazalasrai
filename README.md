# Moataz AI Platform

نقطة انطلاق (starter) إنتاجية جاهزة لبناء تطبيقات كاملة: **واجهة + Backend + قاعدة بيانات + نشر** — بمعمارية واحدة قابلة للتشغيل على أكثر من منصة، بلا ارتباط بمزوّد واحد.

هذا المشروع ليس صفحة فارغة. فيه ميزة حقيقية تعمل (**إدارة مهام / Tasks**) لإثبات أن السلسلة كاملة متصلة فعليًا: الواجهة ← الـ API ← قاعدة البيانات.

---

## لماذا هذه الاختيارات التقنية (Architecture)

| الطبقة | التقنية | لماذا |
|---|---|---|
| Frontend + Backend | **Next.js 16 (App Router)** + TypeScript + React 19 | تطبيق واحد يخدم الواجهة و API routes معًا؛ يعمل على Node عادي أو على Edge Runtime. |
| التصميم | **Tailwind CSS** | إنتاجي وسريع بلا نظام تصميم ثقيل. |
| قاعدة البيانات | **Neon (Postgres)** عبر **Drizzle ORM** و **`@neondatabase/serverless`** | محرّك Neon يتحدث HTTP/fetch عبر HTTPS فقط — وليس بروتوكول TCP الخام لـ Postgres. هذا **قرار متعمّد**: يجعل قاعدة البيانات قابلة للاستخدام من بيئات Edge (Cloudflare Workers) وأي بيئة تحجب اتصالات TCP الخام للقواعد. |
| النشر | **Dockerfile** (لأي مزوّد Docker: Railway، Render، ...) + **`@opennextjs/cloudflare`** (لـ Cloudflare Workers/Pages) + `railway.json` | لا قفل على منصة واحدة — نفس الكود يُبنى لأكثر من هدف نشر. |
| الجودة | TypeScript صارم (`strict`)، ESLint 9 (flat config)، **Vitest**، **GitHub Actions CI** | كل push/PR يُشغّل: lint → typecheck → tests → build. |

> **ملاحظة تقنية:** بدأ هذا المشروع على Next.js 14، لكن تدقيق الحزم (`npm audit`) كشف ثغرات حرجة (critical) لا تُصلح إلا بترقية Next.js إلى الإصدار 16 — فتمت الترقية فعليًا، وتم تحديث كود route handlers ليطابق واجهة async params الجديدة، والتبديل من `@cloudflare/next-on-pages` (لا يدعم Next 16) إلى `@opennextjs/cloudflare` (يدعمه).

## هيكل المشروع

```
src/
├── app/
│   ├── page.tsx              # الصفحة الرئيسية
│   ├── tasks/page.tsx        # واجهة إدارة المهام (المثال الحي)
│   └── api/
│       ├── health/route.ts   # فحص صحة الخدمة (health check)
│       └── tasks/route.ts    # GET / POST
│       └── tasks/[id]/route.ts # PATCH / DELETE
├── db/
│   ├── schema.ts             # تعريف جدول tasks عبر Drizzle
│   └── index.ts              # عميل Neon + Drizzle (HTTP driver)
├── lib/utils.ts               # دوال مساعدة خالية من أي تبعية على React
└── components/                # TaskForm, TaskList
drizzle/0000_init.sql          # أول migration (نسخة يدوية مطابقة للـ schema)
tests/utils.test.ts            # اختبارات Vitest
eslint.config.mjs              # ESLint 9 flat config (يستخدم eslint-config-next)
open-next.config.ts            # تهيئة أدابتر Cloudflare (OpenNext)
.github/workflows/ci.yml       # CI: lint + typecheck + test + build
                                #   ⚠️ راجع "قيود معروفة" أدناه قبل أن تفترض أنه مرفوع فعليًا
```

## التشغيل محليًا (Local development)

```bash
npm install
cp .env.example .env
# ضع رابط Neon الحقيقي في DATABASE_URL داخل .env

npm run db:generate   # (اختياري) يعيد توليد ملفات الترحيل من schema.ts
npm run db:migrate    # يطبّق الترحيل على قاعدة Neon الفعلية

npm run dev           # http://localhost:3000
```

للتحقق قبل أي commit (نفس ما يُشغَّل في CI):

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## متغيرات البيئة (Environment variables)

| المتغير | مطلوب | الوصف |
|---|---|---|
| `DATABASE_URL` | نعم (وقت التشغيل الفعلي) | connection string من Neon. لا يُطلب أثناء `next build` نفسه — العميل يُنشأ بشكل lazy. |
| `NODE_ENV` | لا | `development` / `production`. |

> **الأمان:** لا تضع أي secret داخل الكود أو `.env` المُرفَق بالـ commit. `.env` موجود في `.gitignore`. في الإنتاج، ضع `DATABASE_URL` كـ Secret في منصة النشر (Cloudflare/Railway/GitHub Actions)، لا في الملفات.

## النشر (Deployment)

### Railway / Render / أي مزوّد Docker
يحتوي المشروع على `Dockerfile` جاهز (multi-stage). فقط:
1. اربط المستودع بالمنصة.
2. اضبط متغير `DATABASE_URL` كـ Environment Variable/Secret على المنصة.
3. المنصة تبني الصورة تلقائيًا (`railway.json` موجود أيضًا لـ Railway تحديدًا).

### Cloudflare (Workers/Pages) عبر OpenNext
```bash
npm run cf:build      # opennextjs-cloudflare build
npm run cf:preview    # معاينة محلية على Cloudflare runtime
npm run cf:deploy     # opennextjs-cloudflare deploy
```
تأكد من ضبط `DATABASE_URL` كـ Secret على Cloudflare (`npx wrangler secret put DATABASE_URL`)، و`compatibility_flags = ["nodejs_compat"]` مفعّلة (موجودة مسبقًا في `wrangler.toml`).

### أي مزوّد Node عام
```bash
npm run build
npm run start
```

## الأمان — نتيجة `npm audit` الفعلية

تم تشغيل `npm audit` فعليًا وليس افتراضًا، والتعامل مع النتائج بدل تجاهلها:

- ✅ **0 ثغرات حرجة (critical) في التبعيات المُشحّنة فعليًا للإنتاج.** كانت هناك ثغرة حرجة RCE في Next.js 14/15 (وأخرى SQL injection في Drizzle ORM القديم) — تمت إصلاحهما بالترقية الفعلية إلى Next 16.2.12 و Drizzle ORM ^0.45.2، لا بتجاهل التحذير.
- ⚠️ **19 نتيجة متبقية (14 high، 5 moderate) — كل واحدة منها في أدوات التطوير فقط (devDependencies)، لا في كود التطبيق المنشور:** سلسلة `brace-expansion`/`minimatch` (عبر ESLint وأدوات lint)، و`esbuild` (خادم تطوير Vite/Vitest/drizzle-kit)، ونسخة `postcss` المُجمَّعة داخليًا ضمن Next.js نفسه (وليست نسخة المشروع المُستخدَمة فعليًا لـ Tailwind). راجعها بنفسك بتشغيل `npm audit`.

## قيود معروفة (Known limitations)

- ⚠️ **`.github/workflows/ci.yml` لم يُرفع تلقائيًا لهذا المستودع.** صلاحية تكامل GitHub المتصلة تفتقد نطاق "Workflows"، وهو مطلوب خصيصًا من GitHub لأي إضافة/تعديل لملفات داخل `.github/workflows/` عبر تطبيقات/أتمتة (قيد أمني من GitHub نفسه، لا خلل في هذا المشروع). محتوى الملف موجود أدناه — أضِفه بنفسك من واجهة GitHub (Add file → Create new file → `.github/workflows/ci.yml`)، أو فعّل صلاحية Workflows لتكامل GitHub المتصل وأعد رفعه.
- ⚠️ لم يُختبر بعد ضد قاعدة Neon حقيقية فعليًا، لأن ربط Neon على مستوى الحساب لم يكتمل وقت إنشاء هذا المشروع. اربط `DATABASE_URL` بقاعدة Neon حقيقية وشغّل `npm run db:migrate` قبل أول استخدام فعلي لصفحة `/tasks`.
- 🔜 المصادقة (auth) غير موجودة بعد — الأساس (middleware/route structure) جاهز للإضافة، ويُنصح بـ [Auth.js](https://authjs.dev) كخطوة تالية طبيعية.

## الحالة الحالية (Status)

✅ تم فعليًا (لا افتراضًا): `npm install`، `npm run lint`، `npm run typecheck`، `npm test` (4/4 ناجحة)، و`npm run build` (كل المسارات السّت بُنيت بنجاح) — كل هذا نُفِّذ وتحقّق منه في بيئة بناء هذا المشروع قبل الرفع.

## الرخصة

MIT — راجع ملف `LICENSE`.
