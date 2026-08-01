# نموذج التهديد

## الأصول وحدود الثقة

- الأصول: عضويات المؤسسات، محادثات وملفات، BYOK/OAuth، مفاتيح المنصة، checkpoints وtool arguments.
- الحدود: المتصفح/Flutter، Route Handlers، PostgreSQL، Worker، مزودو AI، MCP، Telegram/GitHub/YouTube.
- tenant والrole وownership تؤخذ من session/API principal على الخادم؛ أي ID من URL/body غير موثوق.

## التهديدات والضوابط

| التهديد | الضوابط الحالية | المتبقي |
|---|---|---|
| BOLA/IDOR | استعلامات tenant-scoped، ownership للأعضاء، RBAC مركزي، اختبارات سلبية موجودة | توسيع PostgreSQL integration لكل route جديد |
| سرقة الجلسة | hash-only tokens، Cookies HttpOnly/Secure/SameSite، absolute+idle expiry، rotation عند org switch | إدارة جهاز مفرد للويب تحتاج قرار UX/schema |
| Refresh replay | compare-and-swap ذري ورفض reuse المتزامن، secure storage في Flutter | سجل token family تاريخي لكشف replay بعد زمن أطول |
| SSRF | HTTPS/ports/DNS/IP ranges/userinfo/redirect deny/timeouts/size limits | pinning نتيجة DNS إلى socket ما زال دفاعًا معمقًا مطلوبًا ضد rebinding؛ يحتاج dispatcher موحدًا لـfetch وMCP SDK |
| XSS/tool injection | React escaping، nonce CSP، فصل تعليمات النظام، redaction وموافقات | `style-src unsafe-inline` قائم مؤقتًا؛ مخرجات الأدوات تبقى untrusted data |
| سرقة الأسرار | AES-256-GCM v2، AAD، key IDs، previous-key read، re-encryption audit | المفاتيح الفعلية يجب أن تبقى في secret manager خارجي |
| Tool abuse | agent/server/tool tenant binding، allowlist، limits، idempotency، approval expiry/consume | الأدوات الجديدة تحتاج تصنيف risk ومراجعة schema قبل التفعيل |
| Supply chain | lockfile، npm audit high، pinned Action SHAs، Dependabot | container SCA/SBOM وDart SCA لم يثبتا في هذه البيئة |

لا تُعامل الملفات أو صفحات الويب أو نتائج الأدوات كتعليمات نظام. Telegram قناة غير موثوقة؛ الأدوات الخطرة تتطلب موافقة بشرية صريحة مرتبطة بالـarguments الحالية.

