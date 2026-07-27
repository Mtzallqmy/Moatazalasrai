# Moataz AI Platform

نقطة انطلاق (starter) إنتاجية جاهزة لبناء تطبيقات كاملة: **واجهة + Backend + قاعدة بيانات + نشر** — بمعمارية واحدة قابلة للتشغيل على أكثر من منصة، بلا ارتباط بمزوّد واحد.

هذا المشروع ليس صفحة فارغة. فيه ميزة حقيقية تعمل (**إدارة مهام / Tasks**) لإثبات أن السلسلة كاملة متصلة فعليًا: الواجهة ← الـ API ← قاعدة البيانات.

---

## لماذا هذه الاختيارات التقنية (Architecture)

| الطبقة | التقنية | لماذا |
|---|---|---|
| Frontend + Backend | **Next.js 14 (App Router)** + TypeScript | تطبيق واحد يخدم الواجهة و API routes معًا؛ يعمل على Node عادي أو على Edge Runtime. |
| التصميم | **Tailwind CSS** | إنتاجي وسريع بلا نظام تصميم ثقيل. |
| قاعدة البيانات | **Neon (Postgres)** عبر **Drizzle ORM** و **`@neondatabase/serverless`** | محرّك Neon يتحدث HTTP/fetch عبر HTTPS فقط — وليس بروتوكول TCP الخام لـ Postgres. هذا **قرار متعمّد**: يجعل قاعدة البيانات قابلة للاستخدام من بيئات Edge (Cloudflare Workers) وأي بيئة تحجب اتصالات TCP الخام للقواعد. |
| النشر | **Dockerfile** (لأي مزوّد Docker: Railway، Render، ...) + **`@cloudflare/next-on-pages`** (لـ Cloudflare Pages) + `railway.json` | لا قفل على منصة واحدة — نفس الكود يُبنى لأكثر من هدف نشر. |
| الجودة | TypeScript صارم (`strict`)، ESLint، **Vitest**، **GitHub Actions CI** | كل push/PR يُشغّل: lint → typecheck → tests → build. |

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
.github/workflows/ci.yml       # CI: lint + typecheck + test + build
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

للتحقق قبل أي commit:

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

### Cloudflare Pages
```bash
npm run pages:build
npx wrangler pages deploy .vercel/output/static
```
تأكد من ضبط `DATABASE_URL` كـ Environment Variable في إعدادات المشروع على Cloudflare، وأن `compatibility_flags = ["nodejs_compat"]` مفعّلة (موجودة مسبقًا في `wrangler.toml`).

### أي مزوّد Node عام
```bash
npm run build
npm run start
```

## الحالة الحالية (Status)

- ✅ الكود مكتمل ومبني (`npm run build`) ومُختبر محليًا في بيئة التطوير التي أنشأت هذا المشروع.
- ⚠️ لم يُختبر بعد ضد قاعدة Neon حقيقية فعليًا داخل تلك البيئة، لأن ربط Neon على مستوى الحساب لم يكتمل وقت إنشاء هذا المشروع. اربط `DATABASE_URL` بقاعدة Neon حقيقية وشغّل `npm run db:migrate` قبل أول استخدام فعلي لصفحة `/tasks`.
- 🔜 المصادقة (auth) غير موجودة بعد — الأساس (middleware/route structure) جاهز للإضافة، ويُنصح بـ [Auth.js](https://authjs.dev) كخطوة تالية طبيعية.

## الرخصة

MIT — راجع ملف `LICENSE`.
