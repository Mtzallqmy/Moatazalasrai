# خريطة الواجهة إلى التنفيذ

| عنصر الواجهة | API/Server | الخدمة | الجداول |
|---|---|---|---|
| إنشاء الحساب | `POST /api/auth/register` | password/session/rate-limit | users, organizations, organization_members, sessions, audit_logs |
| الدخول والخروج | `/api/auth/login`, `/api/auth/logout` | session | users, sessions, audit_logs, rate_limits |
| تبديل المؤسسة | `/api/auth/organization` | session membership check | sessions, organizations, organization_members |
| عدادات اللوحة | Server Component | Drizzle queries | provider_credentials, agents, runs |
| إضافة/فحص مزود | `/api/dashboard/providers*` | provider registry/adapters/network/encryption | provider_credentials, rate_limits, audit_logs |
| تعديل/تعطيل/حذف مزود | PATCH/DELETE providers | relationship guard | provider_credentials, agent_versions, agents, audit_logs |
| إنشاء وكيل | `POST /api/dashboard/agents` | credential/model verification | agents, agent_versions, provider_credentials, audit_logs |
| تعديل ونشر وأرشفة | `PATCH /api/dashboard/agents` | immutable version creation | agents, agent_versions, audit_logs |
| قائمة المحادثات والرسائل | `GET /api/dashboard/chat` | tenant-scoped pagination | conversations, messages |
| تسمية/أرشفة/حذف محادثة | `POST /api/dashboard/chat` | conversation actions | conversations, messages |
| إرسال وإيقاف/إعادة محاولة | `/api/dashboard/chat/stream`, `/api/dashboard/runs` | runtime/provider stream/AbortController | messages, runs, run_events, conversations |
| سجل التشغيل والأحداث | `GET /api/dashboard/runs` + Server Component | runtime queries | runs, run_events, agents |
| الأعضاء والأدوار | `/api/dashboard/members` | RBAC | users, organization_members, audit_logs |
| سجل التدقيق | Server Component | owner/admin gate | audit_logs |
| إعدادات الحساب والمؤسسة | `/api/dashboard/account` | password/session rotation | users, organizations, sessions, audit_logs |
| التشخيص | `/api/diagnostics` | safe checks | database + runtime configuration |

لا توجد أزرار دفع أو أسعار أو بريد أو tools لأن الباكند المقابل غير منفذ.
