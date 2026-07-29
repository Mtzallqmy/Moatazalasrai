# API

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

المسارات تحت `/api/v1` تستخدم `Authorization: Bearer <platform-api-key>`. يجب تخزين المفتاح الأصلي خارجيًا لأنه يظهر مرة واحدة عند bootstrap. واجهة المتصفح الأساسية لا تحتاج bootstrap وتستخدم جلسات المستخدم.
