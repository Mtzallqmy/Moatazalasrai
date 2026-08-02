# نشر الحسابات المتصلة ومتصفح الوكيل وSandbox

هذا الإصدار يضيف ميزات تنفيذية حساسة خلف Feature Flags مغلقة افتراضيًا. لا تُفعّل أي ميزة قبل نشر خدماتها المعزولة وتشغيل migrations والتحقق من readiness.

## المعمارية الإنتاجية

استخدم أربع خدمات مستقلة داخل مشروع Railway نفسه:

1. **Web**: تطبيق Next.js الحالي باستخدام `railway.json`.
2. **Worker**: Graphile Worker الحالي باستخدام `railway.worker.json`.
3. **Sandbox Runner**: خدمة الأوامر والملفات المعزولة باستخدام `railway.sandbox.json` و`services/sandbox-runner/Dockerfile`.
4. **Browser Runner**: خدمة Playwright المعزولة باستخدام `railway.browser.json` و`services/browser-runner/Dockerfile`.

تتصل Web وWorker بـPostgreSQL نفسه. لا تستقبل خدمة Sandbox أو Browser اتصال PostgreSQL ولا مفاتيح مزودي النماذج. الاتصال الداخلي معها موقّع HMAC وبمهلة وإعادة حماية nonce.

## ترتيب النشر

### 1. طبّق قاعدة البيانات

قبل تفعيل الواجهة أو العمال:

```bash
npm ci --no-audit --no-fund
npm run db:migrate:all
```

يجب أن تتضمن قاعدة البيانات migrations حتى:

- `0021_site_connections.sql`
- `0022_agent_sandbox.sql`
- `0023_site_oauth_states.sql`
- `0024_browser_login_sessions.sql`
- `0025_browser_task_runtime.sql`
- `0026_browser_login_identity.sql`

بعدها يجب أن يعيد `/api/ready` حالة ناجحة ويظهر جداول الاتصالات والمتصفح وSandbox ضمن فحص المخطط.

### 2. أنشئ سرّين داخليين

أنشئ قيمتين مختلفتين، ولا تعِد استخدام مفتاح تشفير بيانات الاعتماد:

```bash
openssl rand -base64 48
openssl rand -base64 48
```

- الأولى: `SANDBOX_RUNNER_SHARED_SECRET`
- الثانية: `BROWSER_RUNNER_SHARED_SECRET`

ضع كل سر في Web وWorker والخدمة المقابلة فقط. لا تضع أسرار الخدمات في Git أو متغيرات `NEXT_PUBLIC_*`.

### 3. خدمة Sandbox Runner

أنشئ خدمة Railway جديدة من المستودع نفسه واضبط Config as Code على:

```text
/railway.sandbox.json
```

أضف Volume دائمًا واربطه بالمسار:

```text
/data/workspaces
```

متغيرات الخدمة:

```dotenv
PORT=8080
SANDBOX_RUNNER_SHARED_SECRET=<generated-secret>
SANDBOX_WORKSPACE_ROOT=/data/workspaces
SANDBOX_RUNNER_MAX_REQUEST_BYTES=3145728
SANDBOX_RUNNER_MAX_PROCESSES=64
```

قيود Railway الموصى بها كبداية:

- CPU: 1 vCPU على الأقل.
- Memory: 1 GB على الأقل.
- Replicas: واحدة في MVP؛ زيادة النسخ تتطلب تخزينًا مشتركًا أو توجيهًا ثابتًا للمساحة.
- Volume: 10 GB أو أكثر وفق عدد المساحات وفترة الاحتفاظ.

لا تمنح الخدمة privileged mode ولا Docker socket ولا mounts من خدمة Web. الصورة تعمل بمستخدم غير root وتستخدم Bubblewrap و`prlimit`.

انسخ عنوان الخدمة الداخلي من Railway، مثال:

```text
http://sandbox-runner.railway.internal:8080
```

وضعه في Web وWorker كـ`SANDBOX_RUNNER_URL`.

### 4. خدمة Browser Runner

أنشئ خدمة Railway جديدة واضبط Config as Code على:

```text
/railway.browser.json
```

متغيرات الخدمة:

```dotenv
PORT=8080
BROWSER_RUNNER_SHARED_SECRET=<generated-secret>
BROWSER_RUNNER_PUBLIC_URL=https://<browser-runner-public-domain>
BROWSER_RUNNER_CONCURRENCY=1
BROWSER_LOGIN_TTL_MS=900000
BROWSER_TASK_TTL_MS=900000
BROWSER_RUNNER_MAX_REQUEST_BYTES=2097152
```

احتياجاتها:

- Public HTTPS domain لجلسة تسجيل الدخول التفاعلية فقط.
- Internal Railway URL لطلبات Web وWorker الموقعة.
- Memory: 2 GB موصى بها لكل Chromium متزامن.
- CPU: 1 vCPU على الأقل.
- لا Volume مطلوب للـMVP؛ Browser Context يبقى في ذاكرة الخدمة ويُحفظ `storageState` مشفرًا في PostgreSQL بعد اكتمال الدخول.

ضع العنوان الداخلي في Web وWorker:

```dotenv
BROWSER_RUNNER_URL=http://browser-runner.railway.internal:8080
```

ضع `BROWSER_RUNNER_PUBLIC_URL` داخل خدمة Browser Runner فقط. لا تستخدم عنوان Web بدلًا منه.

### 5. Google OAuth

في Google Cloud Console:

1. أنشئ OAuth Client من نوع Web application.
2. أضف Redirect URI مطابقًا حرفيًا:

```text
https://<web-domain>/api/v1/site-connections/oauth/callback
```

3. أضف متغيرات Web وWorker:

```dotenv
GOOGLE_OAUTH_CLIENT_ID=<client-id>
GOOGLE_OAUTH_CLIENT_SECRET=<client-secret>
GOOGLE_OAUTH_REDIRECT_URI=https://<web-domain>/api/v1/site-connections/oauth/callback
```

الإصدار يطلب فقط `openid email profile`. لا تضف Gmail أو Drive أو Calendar إلا عند إضافة Connector رسمي ذي حاجة فعلية ومراجعة scopes منفصلة.

### 6. متغيرات Web وWorker

ابدأ والميزات مغلقة:

```dotenv
BROWSER_AGENT_ENABLED=false
GOOGLE_OAUTH_INTEGRATIONS_ENABLED=false
BROWSER_INTERACTIVE_LOGIN_ENABLED=false
BROWSER_SCREENSHOTS_ENABLED=false
SANDBOX_ENABLED=false
```

اضبط كذلك:

```dotenv
BROWSER_RUNNER_URL=http://browser-runner.railway.internal:8080
BROWSER_RUNNER_SHARED_SECRET=<browser-secret>
BROWSER_WORKER_CONCURRENCY=1
BROWSER_TASK_TIMEOUT_MS=300000
BROWSER_MAX_STEPS=50
BROWSER_MAX_PAGES=5
BROWSER_ALLOWED_DOWNLOAD_BYTES=10485760
BROWSER_ARTIFACT_RETENTION_DAYS=7

SANDBOX_RUNNER_URL=http://sandbox-runner.railway.internal:8080
SANDBOX_RUNNER_SHARED_SECRET=<sandbox-secret>
SANDBOX_WORKER_CONCURRENCY=1
SANDBOX_EXECUTION_TIMEOUT_MS=300000
SANDBOX_MAX_OUTPUT_BYTES=1048576
SANDBOX_WORKSPACE_DISK_BYTES=536870912
SANDBOX_MAX_CONCURRENT_PER_ORGANIZATION=2
SANDBOX_RETENTION_DAYS=7
```

يجب أن تكون قيم مفاتيح التشفير (`CREDENTIAL_ENCRYPTION_*`) متطابقة في Web وWorker، ولا تُرسل إلى Runner services.

### 7. فعّل تدريجيًا

بعد نجاح health checks:

1. فعّل `GOOGLE_OAUTH_INTEGRATIONS_ENABLED=true` واختبر اتصال Google تجريبيًا.
2. فعّل `SANDBOX_ENABLED=true` واختبر مساحة ومهمة قراءة بسيطة.
3. فعّل `BROWSER_AGENT_ENABLED=true` مع بقاء `BROWSER_INTERACTIVE_LOGIN_ENABLED=false`، وتحقق من رفض مسارات التنفيذ دون اتصال.
4. فعّل `BROWSER_INTERACTIVE_LOGIN_ENABLED=true` واختبر تسجيل دخول يدويًا على fixture أو حساب اختبار.
5. أبقِ `BROWSER_SCREENSHOTS_ENABLED=false` حتى إعداد التخزين الخاص وسياسة التنقيح والاحتفاظ.

## التحقق بعد النشر

نفّذ:

```bash
npm run verify:deployment
```

ثم تحقق يدويًا:

- `/api/health` ناجح.
- `/api/ready` ناجح ويعرض Worker نشطًا.
- صفحة الحسابات المتصلة لا تعرض token أو cookies أو refresh token.
- إنشاء Sandbox لا يشغّل عملية داخل Web replica.
- أمر `printenv` و`rm -rf /` مرفوضان.
- أمر حساس ينتقل إلى صندوق الموافقات.
- إلغاء الأمر يوقف العملية في Runner.
- تسجيل الدخول التفاعلي لا يلتقط screenshot لصفحة كلمات المرور داخل المنصة؛ الإدخال يذهب مباشرة لخدمة Browser Runner.
- مهمة المتصفح لا تفتح نطاقًا غير موجود في allowlist.

## سحب الاتصال وتدوير المفاتيح

- سحب Google يستدعي endpoint السحب ثم يمسح الرموز المشفرة.
- سحب جلسة المتصفح يمسح `encrypted_session_state` ويمنع المهام الجديدة.
- لتدوير مفتاح envelope encryption استخدم دليل التشغيل الحالي و`npm run secrets:reencrypt`. لا تغيّر المفتاح مباشرة.
- لتدوير أسرار Runner: أضف السر الجديد للخدمة وWeb/Worker في نافذة نشر واحدة؛ لا توجد قراءة متعددة الإصدارات لأسرار HMAC.

## مخاطر تشغيلية متبقية عند التوسّع

- زيادة Browser Runner إلى أكثر من replica تحتاج session affinity أو مخزن جلسات خارجي؛ لا ترفع replicas عشوائيًا.
- زيادة Sandbox Runner إلى أكثر من replica تحتاج Volume مشتركًا أو توجيه workspace ثابتًا.
- الشبكة في Sandbox معطلة افتراضيًا. تفعيل allowlist الخارجي يحتاج طبقة egress proxy منفصلة، وليس فتح الشبكة العامة للحاوية.
- لا تستخدم حسابات إنتاجية عالية الصلاحية في اختبارات E2E.
