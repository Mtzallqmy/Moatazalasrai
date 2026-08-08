# تطبيق معتز AI لنظام Android

هذا تطبيق Flutter أصلي بالكامل. لا يستخدم `WebView` ولا يعرض صفحات الموقع؛ كل
البيانات والمحادثات تأتي من REST API وتُحفظ في PostgreSQL.

## الوظائف

- تسجيل عضو جديد أو الدخول إلى مساحة عمل قائمة.
- خيار حفظ الجلسة مشفرة واستعادتها تلقائيًا، أو إبقاؤها مؤقتة حتى إغلاق التطبيق.
- لوحة تحكم وقائمة كاملة حسب RBAC للمحادثات والوكلاء والفرق والتشغيلات والملفات
  والمزودات وMCP والتكاملات والأعضاء والتدقيق والإعدادات.
- استعادة سجل المحادثات ورسائلها، وإعادة التسمية والأرشفة والحذف.
- رفع صور وPDF وOffice ونصوص وأرشيفات وصوت وفيديو حتى 10MB وتحليل المحتوى
  المستخرج، مع إرسال الصور إلى النماذج الداعمة للرؤية.
- ثيمات محادثة معتز وواتساب وتليجرام وخلفيات محفوظة ومتزامنة.
- مكتبة وكلاء إنتاجية تتضمن محلل YouTube ووكيل البرمجة والمهام ومدقق المواقع.
- ربط مزودات متحققة وخوادم MCP حقيقية من التطبيق للأدوار المخولة.

## التشغيل

```bash
flutter pub get
flutter run --dart-define=API_BASE_URL=https://moatazalalqami.online \
  --dart-define=SUPABASE_URL=https://PROJECT.supabase.co \
  --dart-define=SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

## بناء APK

```bash
flutter build apk --release \
  --dart-define=API_BASE_URL=https://moatazalalqami.online \
  --dart-define=SUPABASE_URL=https://PROJECT.supabase.co \
  --dart-define=SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

قبل النشر في المتجر، أضف أسرار التوقيع الموضحة في دليل الإصدار. يقرأ البناء
`android/key.properties` دون حفظ المفتاح في Git. يحفظ Supabase Flutter الجلسة الآمنة،
ويحتفظ التطبيق بمعرّف المؤسسة فقط في `flutter_secure_storage`.

يبني GitHub Actions إصدارًا واحدًا خاصًا بأجهزة `arm64-v8a` وينشره تلقائيًا في
GitHub Releases. راجع [دليل الإصدار](../../docs/ANDROID_RELEASE.md).

## التدفق الأمني

1. يسجل الجهاز الدخول أو ينشئ الحساب عبر Supabase Auth (Google أو البريد وكلمة المرور).
2. يرسل Supabase Access Token إلى `/api/mobile/v1/auth/session` لربط الهوية بالمستخدم وعضويات Railway.
3. يضيف التطبيق Access Token ومعرّف مساحة العمل لكل طلب API.
4. عند `401` يجدد الجلسة مرة واحدة عبر Supabase SDK ويعيد الطلب.
5. لا يُضمّن Platform API Key داخل التطبيق.

إزالة التطبيق من Android تمسح بياناته المحلية بحسب نظام الجهاز؛ المحادثات نفسها
تبقى في PostgreSQL وتعود بعد تسجيل الدخول مجددًا.
