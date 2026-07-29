# استكشاف الأخطاء

## `DATABASE_URL is required`

أضف `DATABASE_URL=${{Postgres.DATABASE_URL}}` داخل خدمة التطبيق في بيئة production ثم Deploy Changes.

## Telegram لا يجيب

تحقق من `APP_URL`، وحالة التكامل، والوكيل المنشور، والمزود المتحقق. أعد تفعيل Webhook ثم استخدم `/status`.

## الوكيل غير متاح

تأكد أن حالته published وأن الإصدار الحالي مرتبط بنموذج ما زال ضمن النماذج المكتشفة.

## خطأ مزود

استخدم code وrequestId والإجراء المقترح. لا ترسل التوكن أو Authorization للدعم.

## `/api/ready` يعيد 503

راجع pre-deploy migration واتصال PostgreSQL والجداول المطلوبة. لا تستبدل readiness بفحص سطحي.
