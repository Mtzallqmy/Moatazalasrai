# المساهمة

استخدم Node `22.18.0` وPostgreSQL معزولًا. لا تستخدم قاعدة إنتاج أو أسرارًا حقيقية.

```bash
npm ci
npm run lint
npm run typecheck
npm test
TEST_DATABASE_URL=postgresql://... npm run test:integration
E2E_BASE_URL=http://127.0.0.1:3000 npm run test:e2e
npm run build
```

داخل `apps/mobile`: `flutter pub get && flutter analyze && flutter test`. فحص APK غير المنشور فقط يحتاج `ALLOW_DEBUG_RELEASE_SIGNING=true flutter build apk --release`؛ الإصدار المنشور يتطلب keystore.

- استخدم Conventional Commits، migration additive، واختبار رجوع لكل إصلاح مهم.
- لا تسجل prompts أو content أو tokens أو Cookies. لا تضع secrets في fixtures.
- كل استعلام مورد يجب أن يقيد `organizationId` ثم ownership/role عند الحاجة.
- لا تضف UI لميزة بلا backend حقيقي، ولا توسع scope API ضمنيًا.
