<!-- Phase 0 runbook for reproducible local development and CI validation. -->
# إعداد بيئة التطوير

## المتطلبات

- Docker Engine مع Docker Compose v2.
- Node.js بالإصدار المحدد في `.nvmrc` عند التشغيل خارج Docker.
- ملف `.env` محلي غير ملتزم به داخل Git.

أنشئ ملف البيئة مرة واحدة:

```bash
cp .env.example .env
```

عدّل القيم الإلزامية على الأقل:

```dotenv
CREDENTIAL_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
CREDENTIAL_ENCRYPTION_KEY_ID=local
BOOTSTRAP_ADMIN_TOKEN=<long-random-token>
```

لا تغيّر `DATABASE_URL` يدويًا لتشغيل Compose؛ الملف `docker-compose.yml` يضبطه داخل الحاويات ليتصل بخدمة `postgres`.

## التشغيل عبر Docker Compose

ابدأ الخدمات الثلاث:

```bash
docker compose up -d --build
```

الخدمات:

| الخدمة | الوظيفة | المنفذ/الفحص |
|---|---|---|
| `web` | Next.js في وضع التطوير، ويطبق migrations قبل الإقلاع | `http://localhost:3000` و`/api/ready` |
| `worker` | Graphile Worker باستخدام نفس إعداد ومجمع اتصالات PostgreSQL داخل عملية العامل | فحص heartbeat في PostgreSQL |
| `postgres` | PostgreSQL 16 مع volume دائم | `localhost:5432` و`pg_isready` |

راقب الحالة والسجلات:

```bash
docker compose ps
docker compose logs -f web worker postgres
```

نفّذ الأوامر داخل خدمة الويب عند الحاجة:

```bash
docker compose exec web npm run lint
docker compose exec web npm run typecheck
docker compose exec web npm test
```

أوقف الخدمات مع الاحتفاظ ببيانات PostgreSQL:

```bash
docker compose down
```

لإعادة البيئة إلى قاعدة فارغة بالكامل:

```bash
docker compose down --volumes --remove-orphans
```

يمكن تغيير منافذ المضيف دون تعديل الملف:

```bash
WEB_PORT=3001 POSTGRES_PORT=55432 docker compose up -d
```

## تشغيل فحوص CI محليًا

المسار الأكثر تطابقًا مع GitHub Actions هو تشغيل الأوامر بالتسلسل التالي من جذر المشروع:

```bash
nvm use
npm ci
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
docker compose up -d postgres
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/moatazalasrai \
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/moatazalasrai \
  npm run db:migrate:all
```

يمكن استخدام [`act`](https://github.com/nektos/act) لتشغيل Workflow محليًا، مع ملاحظة أن محاكاة service containers وDocker داخل runner قد تختلف باختلاف نظام التشغيل:

```bash
act pull_request -W .github/workflows/ci.yml
```

عند تعذر تشغيل `act`، استخدم التسلسل السابق ثم نفّذ اختبار Compose الكامل:

```bash
docker compose up -d --build
curl --fail http://localhost:3000/api/ready
docker compose exec worker node scripts/healthcheck-worker.mjs
```

## فحوص كل Pull Request

يعمل `.github/workflows/ci.yml` على كل Pull Request إلى `main`، ويتوقف فور فشل أي خطوة:

1. قراءة إصدار Node.js من `.nvmrc` وتفعيل npm cache.
2. التحقق من اتساق lockfile ثم `npm ci`.
3. تدقيق اعتماديات الإنتاج عالية/حرجة الخطورة.
4. ESLint.
5. TypeScript typecheck.
6. اختبارات Vitest الوحدوية.
7. اختبارات Playwright E2E.
8. بناء Next.js الإنتاجي.
9. تطبيق migrations الخاصة بالمنصة وGraphile Worker على PostgreSQL 16 نظيف.
10. رفع `web + worker + postgres` عبر Docker Compose والتحقق من readiness والـheartbeat.

## قرار سائق PostgreSQL

السائق المعتمد هو `pg` لأن Graphile Worker يستخدم `pg.Pool` أصلًا. Drizzle يستعمل `drizzle-orm/node-postgres`، وتشارك مكونات العملية الواحدة singleton pool من `src/db/pool.ts`. لا تُنشأ اتصالات جديدة لكل طلب، وتستخدم أدوات Queue والـWorker المجمع نفسه داخل عملية العامل. أما عمليتا `web` و`worker` فهما حاويتان منفصلتان، ولذلك لكل عملية singleton pool مستقل بالضرورة مع نفس الضبط والسائق.
