# تطبيق معتز AI لنظام Android

هذا تطبيق Flutter أصلي بالكامل. لا يستخدم `WebView` ولا يعرض صفحات الموقع؛ كل البيانات والمحادثات تأتي من REST API.

## التشغيل

```bash
flutter pub get
flutter run --dart-define=API_BASE_URL=https://your-domain.example
```

## بناء APK

```bash
flutter build apk --release \
  --dart-define=API_BASE_URL=https://your-domain.example
```

قبل النشر في المتجر، أضف أسرار التوقيع الموضحة في دليل الإصدار. يقرأ البناء
`android/key.properties` دون حفظ المفتاح في Git. تحفظ رموز الوصول والتحديث في
Android Keystore باستخدام `flutter_secure_storage`، ويُدوّر Refresh Token عند كل
تحديث للجلسة.

يبني GitHub Actions إصدارًا واحدًا خاصًا بأجهزة `arm64-v8a` وينشره تلقائيًا في
GitHub Releases. راجع [دليل الإصدار](../../docs/ANDROID_RELEASE.md).

## التدفق الأمني

1. يسجل الجهاز الدخول عبر `/api/mobile/v1/auth/login`.
2. يتلقى Access Token قصير العمر وRefresh Token دواراً مرتبطين بالمستخدم والجهاز ومساحة العمل.
3. يضيف التطبيق Access Token لكل طلب API.
4. عند `401` يجدد الرمزين مرة واحدة ويعيد الطلب.
5. لا يُضمّن Platform API Key داخل التطبيق.
