# منصة معتز للوكلاء الذكيين

منصة SaaS عربية، متعددة المؤسسات، لبناء وكلاء ذكاء اصطناعي وتشغيلهم باستخدام مفاتيح المستخدم (BYOK). المشروع مبني على Next.js App Router وReact وTypeScript وTailwind وDrizzle وPostgreSQL/Neon.

لا يتضمن المشروع دفعًا أو اشتراكات أو أسعارًا أو فوترة.

## ما يعمل فعليًا

- تسجيل حساب ومؤسسة، تسجيل الدخول والخروج، جلسات مخزنة كـhash داخل PostgreSQL، واختيار مؤسسة نشطة عند تعدد العضويات.
- RBAC من الباكند للأدوار: `owner` و`admin` و`developer` و`operator` و`viewer`.
- إدارة أعضاء المؤسسة للمستخدمين المسجلين، دون دعوات بريد وهمية.
- اتصالات OpenAI وAnthropic وGemini وOpenAI-compatible عبر Adapters موحدة.
- فحص DNS/TLS والاعتماد ومسار النماذج، ثم اختبار توليد حقيقي لنموذج قبل حفظ المزود كـ`verified`.
- حماية SSRF للمزود المخصص، مهلات، منع redirects، حدود للاستجابة، أخطاء منقحة، ومحاولات محدودة للأعطال المؤقتة.
- تشفير مفاتيح المزودات باستخدام AES-256-GCM داخل envelope بإصدار وnonce عشوائي وauthentication tag.
- إنشاء الوكلاء وإصدارات ثابتة، نشر/أرشفة/استعادة، واختيار نموذج مكتشف فعليًا.
- محادثات محفوظة، سياق سابق بميزانية Tokens تقديرية، Streaming، إيقاف، إعادة محاولة، إعادة تسمية، أرشفة وحذف.
- دورة تشغيل `queued → running → completed / failed / cancelled` وأحداث فعلية ومعرّفات طلب واستهلاك Tokens عندما يوفره المزود.
- لوحة عربية RTL متجاوبة للمزودات والوكلاء والمحادثات والتشغيل والأعضاء والتدقيق والإعدادات والتشخيص.
- Health وreadiness منفصلان، Security headers، CSRF/Origin checks، rate limits مخزنة، ورسائل API موحدة.

## المتطلبات

- Node.js 20.11 أو أحدث.
- قاعدة PostgreSQL/Neon مستقلة.
- مفتاح تشفير 32 بايت بصيغة Base64.

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

التطبيق: `http://localhost:3000`

## متغيرات البيئة

| المتغير | مطلوب | الاستخدام |
|---|---:|---|
| `DATABASE_URL` | نعم | اتصال PostgreSQL/Neon وقت التشغيل، ولا يُستخدم أثناء build |
| `CREDENTIAL_ENCRYPTION_KEY` | نعم | مفتاح Base64 بطول 32 بايت لتشفير مفاتيح المزودات |
| `APP_URL` | في الإنتاج | أصل HTTPS الموثوق لحماية CSRF |
| `BOOTSTRAP_ADMIN_TOKEN` | اختياري | تهيئة API للمنصة مرة واحدة؛ التسجيل العادي لا يحتاجه |
| `LOG_LEVEL` | لا | `debug` أو `info` أو `warn` أو `error` |
| `TEST_DATABASE_URL` | للاختبار التكاملي | قاعدة اختبار منفصلة جرى تطبيق migrations عليها |
| `E2E_BASE_URL` | لـE2E | نشر اختبار مستقل |
| `E2E_PROVIDER_*` | للاختبار الحي فقط | أسرار مزود اختبار مخصصة، ولا توضع في المستودع |

توليد مفتاح التشفير:

```bash
openssl rand -base64 32
```

لا تغيّر `CREDENTIAL_ENCRYPTION_KEY` بعد حفظ مزودات دون خطة لإعادة تشفير الأسرار.

## قاعدة البيانات

`src/db/schema.ts` هو مخطط Drizzle المرجعي، و`drizzle/` يحتوي سجل migrations. التطبيق لا يشغّل migrations مع طلبات HTTP أو عند بدء كل replica.

```bash
npm run db:generate
npm run db:migrate
npm run db:studio
```

الجداول الأساسية: `users`, `sessions`, `organizations`, `organization_members`, `provider_credentials`, `agents`, `agent_versions`, `conversations`, `messages`, `runs`, `run_events`, `platform_api_keys`, `audit_logs`, `rate_limits`.

## التحقق قبل الدمج

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

اختبارات E2E تتخطى التنفيذ ما لم يُضبط `E2E_BASE_URL`. اختبار المزود الحي يتطلب أسرار `E2E_PROVIDER_*` مخصصة. لا توجد مفاتيح مزود داخل الاختبارات.

## النشر

المسار الأساسي هو Docker/Railway مع Node runtime. شغّل migrations كخطوة إصدار مستقلة، ثم انشر التطبيق، وافحص:

- `/api/health`: liveness دون اتصال عميق بالخدمات.
- `/api/ready`: جاهزية قاعدة البيانات والمخطط.

راجع [دليل النشر](docs/DEPLOYMENT.md).

## وثائق المشروع

- [المعمارية](docs/ARCHITECTURE.md)
- [الأمان](docs/SECURITY.md)
- [المصادقة والمؤسسات](docs/AUTHENTICATION.md)
- [واجهات API](docs/API.md)
- [خريطة الواجهة إلى الباكند](docs/UI_BACKEND_MAP.md)
- [التدقيق والقيود](docs/CURRENT_STATE_AUDIT.md)
- [تقرير التسليم والتحقق](docs/DELIVERY_REPORT.md)

## قيود حقيقية

- لا توجد استعادة كلمة مرور أو تأكيد بريد أو دعوات بريد قبل إعداد مزود بريد حقيقي.
- لا يوجد دفع أو اشتراك أو فوترة.
- إيقاف Streaming يستخدم `AbortController` ويكون فوريًا داخل instance نفسه؛ تشغيل عدة replicas يحتاج قناة إلغاء مشتركة.
- ميزانية السياق تقديرية لأن حدود النماذج تختلف؛ لا يتم اختلاق usage عند غيابها من المزود.
- لم يُنشأ Queue/worker منفصل؛ التشغيل يحدث داخل طلب Node طويل العمر.
- دعم النشر لا يعني أن نشرًا إنتاجيًا حيًا تم إجراؤه. راجع نتائج التحقق الفعلية في تقرير التسليم.

## الرخصة

MIT
