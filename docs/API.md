# API

## واجهة التطبيقات الأصلية

يستخدم تطبيق Android واجهة `/api/mobile/v1/*` لإصدار جلسة جهاز ثم واجهة
`/api/v1/*` مع Access Token قصير العمر في `Authorization: Bearer`. لا يُضمّن
التطبيق مفتاح منصة. تستخدم الأتمتة الخادمية Platform API Key محدود النطاقات.
تدعم المحادثات الإنشاء والقائمة والرسائل وإعادة
التسمية والأرشفة والاستعادة والتثبيت والنقل والحذف المنطقي. وتدعم
`PATCH /api/v1/messages` تعديل الرسالة أو حذفها أو استعادتها. جميع الموارد
معزولة بالمؤسسة المرتبطة بالمفتاح وتستخدم غلاف الاستجابة الموحد.

## APIs التوسعة الاختيارية

تعيد هذه المسارات `FEATURE_DISABLED` حتى تفعيل Feature Flag الموافق:

- `GET|POST|DELETE /api/memories`
- `GET|POST /api/knowledge-bases`
- `GET|POST /api/knowledge-bases/:id/documents`
- `GET /api/tools`
- `GET|PATCH /api/tool-approvals`
- `GET|DELETE /api/jobs`

كل المعرفات تتحقق من المؤسسة النشطة، وكل mutation يطبق Same-Origin وZod وRBAC.

كل API حديث يعيد أحد الشكلين:

```json
{"success":true,"data":{},"meta":{"requestId":"..."}}
```

```json
{"success":false,"error":{"code":"...","message":"...","requestId":"..."}}
```

## المصادقة

| المسار | الطريقة | الوظيفة |
|---|---|---|
| `/api/auth/register` | POST | إنشاء حساب ومؤسسة وجلسة |
| `/api/auth/login` | POST | التحقق وإصدار جلسة |
| `/api/auth/logout` | POST | إبطال الجلسة الحالية |
| `/api/auth/organization` | GET/POST | قائمة العضويات وتبديل المؤسسة |
| `/api/auth/sessions` | DELETE | إبطال كل جلسات المستخدم |

## لوحة التحكم

| المسار | الطرق | الصلاحية |
|---|---|---|
| `/api/dashboard/providers` | GET/POST/PATCH/DELETE | قراءة أو إدارة المزودات |
| `/api/dashboard/providers/validate` | POST | فحص مؤقت دون حفظ |
| `/api/dashboard/agents` | GET/POST/PATCH | الوكلاء والإصدارات |
| `/api/dashboard/chat` | GET/POST | المحادثات والرسائل وإجراءات المحادثة |
| `/api/dashboard/chat/stream` | POST | SSE لتشغيل الوكيل وبث الرد |
| `/api/dashboard/runs` | GET/DELETE | القائمة/الأحداث وإلغاء Run |
| `/api/dashboard/members` | GET/POST | أعضاء المؤسسة والأدوار |
| `/api/dashboard/account` | PATCH | الحساب والمؤسسة وكلمة المرور |
| `/api/diagnostics` | GET | تشخيص owner/admin |

## SSE

`POST /api/dashboard/chat/stream` يعيد الأحداث:

- `message`: رسالة المستخدم المحفوظة.
- `run`: معرّف Run.
- `delta`: جزء نصي.
- `complete`: معرّف رسالة المساعد والـusage.
- `error`: خطأ منقح وrequest ID.

## الصحة

- `GET /api/health`: 200 عندما تعمل العملية، بلا اتصال عميق.
- `GET /api/ready`: 200 عند توفر قاعدة البيانات والجداول المطلوبة، وإلا 503 دون أسرار.

## Platform API

المسارات تحت `/api/v1` تقبل `Authorization: Bearer <platform-api-key>` أو رمز
الهاتف `mat_…`. يجب تخزين مفتاح المنصة الأصلي خارجيًا لأنه يظهر مرة واحدة عند
الإنشاء، وتُطبق نطاقات مثل `agents:read`, `conversations:write`, `runs:write`,
`teams:write`.

## جلسات الهاتف

| المسار | الطريقة | المصادقة | الوظيفة |
|---|---|---|---|
| `/api/mobile/v1/auth/login` | POST | عامة + rate limit | التحقق واختيار المؤسسة وإصدار رمزين |
| `/api/mobile/v1/auth/refresh` | POST | Refresh Token | تدوير الرمزين وإبطال السابق |
| `/api/mobile/v1/auth/logout` | POST | Refresh Token | إبطال جلسة الجهاز |
| `/api/mobile/v1/me` | GET | Access Token | الهوية والعضوية والنطاقات |

رمز الوصول مدته 15 دقيقة ورمز التحديث 30 يومًا. لا تحفظ القاعدة القيم الأصلية؛
تحفظ SHA-256 hash فقط.
# API v1 للتطبيقات الأصلية

جميع الاستجابات JSON موحدة وتحتوي `requestId`. المصادقة عبر `Authorization: Bearer <PLATFORM_API_KEY>`. لا تستخدم Cookies الخاصة بلوحة الويب داخل تطبيق Android.

| المسار | الطرق | الغرض |
|---|---|---|
| `/api/v1/openapi` | GET | عقد اكتشاف OpenAPI |
| `/api/v1/agents` | GET, POST | الوكلاء |
| `/api/v1/conversations` | GET, POST | المحادثات والرسائل |
| `/api/v1/chat` | POST | رسالة ومرفقات وتشغيل فعلي |
| `/api/v1/files` | GET, POST | قائمة/تنزيل ورفع multipart |
| `/api/v1/runs` | GET, POST | التشغيل والسجل |
| `/api/v1/teams` | GET, POST | فرق الوكلاء |
| `/api/v1/team-runs` | GET, POST | التشغيل المتوازي ونتيجة المشرف؛ يتطلب `Idempotency-Key` |
| `/api/v1/integrations` | GET | صحة التكاملات دون أسرار |
| `/api/v1/github` | POST | عرض المستودعات أو قراءة ملف |

رفع الملفات يقبل `multipart/form-data` بحقل `file` وحقل `conversationId` الاختياري. الحد الأقصى 10MB والأنواع المسموحة: JPEG, PNG, WebP, GIF, PDF, TXT, Markdown, CSV, JSON.

تكامل Telegram يستقبل فقط Webhook يحمل `X-Telegram-Bot-Api-Secret-Token` المطابق للسر الذي أنشأته المنصة، ويحفظ `update_id` لمنع التنفيذ المكرر.
