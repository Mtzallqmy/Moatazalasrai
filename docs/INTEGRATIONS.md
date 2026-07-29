# التكاملات

تُدار Telegram وGitHub عبر `IntegrationAdapter` في `src/server/integrations/registry.ts`. التوكنات مشفرة ولا تعاد إلى العميل.

## Telegram

- يتحقق `getMe` قبل الحفظ.
- Webhook HTTPS مع secret token و`update_id` فريد.
- التنفيذ الثقيل يحدث بعد قبول Webhook.
- الأوامر: `/start`, `/help`, `/new`, `/status`, `/github repos`, `/github read`.
- أعد تفعيل Webhook من صفحة التكاملات عند تغيير `APP_URL`.

## GitHub

يدعم قراءة الحساب والمستودعات والملفات فقط. لا كتابة ولا حذف ولا force-push. استخدم fine-grained token بأقل صلاحيات Contents: Read وMetadata: Read.

## إضافة تكامل لاحقًا

أضف Adapter بعقد Registry، schema، health check، error normalization واختبارات، ثم اربطه بالخدمة دون استدعائه مباشرة من مكونات الواجهة.
