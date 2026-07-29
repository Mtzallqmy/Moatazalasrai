# إصدار Android ‏arm64

يبني مسار `Android arm64 Release` تطبيق Flutter الأصلي من المصدر، ويفحصه ثم ينشر
ملف APK واحدًا لمعمارية `arm64-v8a` داخل GitHub Releases. التطبيق يستهلك API ولا
يستخدم WebView.

## الإصدار اليدوي

من تبويب Actions اختر `Android arm64 Release` ثم `Run workflow`، وأدخل رقمًا
دلاليًا مثل `1.1.0`. ينشئ المسار الوسم `android-v1.1.0` وملفًا باسم:

```text
Moataz-AI-1.1.0-arm64.apk
```

يمكن كذلك دفع وسم مطابق للنمط `android-v*`.

عند دمج تغيير يمس تطبيق الهاتف أو Workflow في `main`، تُقرأ النسخة تلقائيًا من
`apps/mobile/pubspec.yaml`. لذلك يجب رفع رقم `version` مع كل إصدار جديد لتجنب
استبدال أصل إصدار سابق يحمل الوسم نفسه.

## توقيع الإنتاج

أضف الأسرار التالية في إعدادات المستودع:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_STORE_PASSWORD`

يجب أن تكون قيمة Keystore مشفرة Base64 دون أسطر إضافية. لا يُحفظ ملف المفتاح أو
كلمات المرور في Git. عند غياب الأسرار يظل البناء قابلًا للتثبيت لأغراض الاختبار
بتوقيع Android التجريبي، لكنه ليس توقيع نشر متجر Google Play.
