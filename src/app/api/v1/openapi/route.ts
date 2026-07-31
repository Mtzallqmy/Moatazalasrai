import { NextResponse } from "next/server";

const success = {
  "200": {
    description: "نجاح",
    content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } },
  },
};
const accepted = {
  "202": {
    description: "تم قبول الطلب للتنفيذ غير المتزامن",
    headers: {
      Location: { schema: { type: "string" } },
      "Retry-After": { schema: { type: "integer" } },
    },
    content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } },
  },
};
const errors = {
  "400": { description: "طلب غير صالح", content: { "application/json": { schema: { $ref: "#/components/schemas/Failure" } } } },
  "401": { description: "رمز وصول غير صالح أو منتهي" },
  "403": { description: "النطاق أو الصلاحية غير كافيين" },
  "404": { description: "المورد غير موجود داخل المؤسسة" },
  "409": { description: "تعارض حالة أو idempotency أو موافقة" },
  "422": { description: "تعذر تنفيذ الطلب بقيمه الحالية" },
  "429": { description: "تجاوز معدل الطلبات أو حدود الأدوات" },
};

const uuid = { type: "string", format: "uuid" };
const object = { type: "object", additionalProperties: false };

function jsonBody(schema: Record<string, unknown>) {
  return { required: true, content: { "application/json": { schema } } };
}

function operation(input: {
  operationId: string;
  summary: string;
  tag: string;
  auth?: boolean;
  body?: Record<string, unknown>;
  status?: 200 | 201 | 202;
  parameters?: Array<Record<string, unknown>>;
}) {
  const response = input.status === 202
    ? accepted
    : input.status === 201
      ? { "201": { description: "تم الإنشاء", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } } }
      : success;
  return {
    operationId: input.operationId,
    summary: input.summary,
    tags: [input.tag],
    ...(input.auth === false ? { security: [] } : {}),
    ...(input.body ? { requestBody: jsonBody(input.body) } : {}),
    ...(input.parameters ? { parameters: input.parameters } : {}),
    responses: { ...response, ...errors },
  };
}

const idPath = (name: string) => [{ name, in: "path", required: true, schema: uuid }];
const approvalPath = [{ name: "approvalId", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 200 } }];

export function GET() {
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "Moataz AI Platform API",
      version: "2.1.0",
      description: "واجهة REST متعددة المؤسسات. مفاتيح BYOK تبقى مشفرة على الخادم، وتشغيلات الفرق والموافقات تنفذ عبر PostgreSQL وGraphile Worker.",
    },
    servers: [{ url: "/", description: "الخادم الحالي" }],
    tags: [
      { name: "Mobile Auth" },
      { name: "Mobile Workspace" },
      { name: "Agents" },
      { name: "Conversations" },
      { name: "Runs" },
      { name: "Agent Teams" },
      { name: "Tool Approvals" },
      { name: "Files" },
      { name: "Providers" },
      { name: "Integrations" },
      { name: "MCP" },
      { name: "Tools" },
    ],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "mat_ access token or platform API key",
          description: "رمز جلسة هاتف قصير أو مفتاح منصة ذي نطاقات. لا ترسل organizationId من العميل كمصدر ثقة.",
        },
      },
      schemas: {
        Success: {
          type: "object",
          required: ["success", "data", "meta"],
          properties: {
            success: { const: true },
            data: {},
            meta: { type: "object", required: ["requestId"], properties: { requestId: { type: "string" } } },
          },
        },
        Failure: {
          type: "object",
          required: ["success", "error"],
          properties: {
            success: { const: false },
            error: {
              type: "object",
              required: ["code", "message", "requestId"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                requestId: { type: "string" },
                details: {},
              },
            },
          },
        },
        RunStatus: { type: "string", enum: ["queued", "running", "waiting_approval", "completed", "failed", "cancelled"] },
        TeamRunStatus: { type: "string", enum: ["queued", "running", "waiting_approval", "completed", "failed", "cancelled"] },
        MobileLogin: {
          ...object,
          required: ["email", "password", "deviceId"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8 },
            deviceId: { type: "string", minLength: 8 },
            deviceName: { type: "string" },
            organizationId: uuid,
            rememberSession: { type: "boolean", default: true },
          },
        },
        ConversationCreate: { ...object, required: ["agentId"], properties: { agentId: uuid, title: { type: "string", maxLength: 120 } } },
        ChatInput: {
          ...object,
          required: ["conversationId", "message"],
          properties: {
            conversationId: uuid,
            message: { type: "string", minLength: 1, maxLength: 30000 },
            attachmentIds: { type: "array", items: uuid, maxItems: 5 },
            inputKind: { enum: ["text", "image", "file", "coding", "summary", "analysis", "audio", "video"] },
          },
        },
        TeamCreate: {
          ...object,
          required: ["name", "supervisorAgentId", "memberAgentIds"],
          properties: {
            name: { type: "string", minLength: 2, maxLength: 100 },
            description: { type: "string", maxLength: 500 },
            supervisorAgentId: uuid,
            memberAgentIds: { type: "array", minItems: 1, maxItems: 5, items: uuid },
            maxParallelWorkers: { type: "integer", minimum: 1, maximum: 5, default: 3 },
          },
        },
        TeamRunCreate: { ...object, required: ["teamId", "input"], properties: { teamId: uuid, input: { type: "string", minLength: 1, maxLength: 20000 } } },
        ApprovalDecision: { ...object, properties: { reason: { type: "string", maxLength: 500 } } },
      },
    },
    paths: {
      "/api/mobile/v1/auth/login": { post: operation({ operationId: "mobileLogin", summary: "تسجيل دخول جهاز واختيار مساحة العمل", tag: "Mobile Auth", auth: false, body: { $ref: "#/components/schemas/MobileLogin" } }) },
      "/api/mobile/v1/auth/register": { post: operation({ operationId: "mobileRegister", summary: "إنشاء حساب عضو وإصدار جلسة جهاز", tag: "Mobile Auth", auth: false, status: 201, body: { type: "object" } }) },
      "/api/mobile/v1/auth/refresh": { post: operation({ operationId: "mobileRefresh", summary: "تدوير رمزي الوصول والتحديث", tag: "Mobile Auth", auth: false, body: { type: "object" } }) },
      "/api/mobile/v1/auth/logout": { post: operation({ operationId: "mobileLogout", summary: "إبطال جلسة الجهاز", tag: "Mobile Auth", auth: false, body: { type: "object" } }) },
      "/api/mobile/v1/me": { get: operation({ operationId: "mobileMe", summary: "هوية المستخدم ونطاقاته", tag: "Mobile Auth" }) },
      "/api/mobile/v1/workspace": { get: operation({ operationId: "mobileWorkspace", summary: "المؤسسة والصلاحيات والأعضاء والتدقيق وMCP", tag: "Mobile Workspace" }) },
      "/api/v1/agents": {
        get: operation({ operationId: "listAgents", summary: "عرض الوكلاء المنشورين", tag: "Agents" }),
        post: operation({ operationId: "createAgent", summary: "إنشاء وكيل", tag: "Agents", status: 201, body: { type: "object" } }),
      },
      "/api/v1/agent-templates": {
        get: operation({ operationId: "listAgentTemplates", summary: "عرض مكتبة الوكلاء", tag: "Agents" }),
        post: operation({ operationId: "installAgentTemplate", summary: "تثبيت قالب وربطه بمزود متحقق", tag: "Agents", status: 201, body: { type: "object" } }),
      },
      "/api/v1/conversations": {
        get: operation({ operationId: "listConversations", summary: "عرض المحادثات أو رسائل محادثة", tag: "Conversations", parameters: [{ name: "conversationId", in: "query", schema: uuid }] }),
        post: operation({ operationId: "createConversation", summary: "إنشاء محادثة", tag: "Conversations", status: 201, body: { $ref: "#/components/schemas/ConversationCreate" } }),
        patch: operation({ operationId: "updateConversation", summary: "تعديل حالة المحادثة", tag: "Conversations", body: { type: "object" } }),
        delete: operation({ operationId: "deleteConversation", summary: "حذف محادثة منطقيًا", tag: "Conversations", body: { type: "object" } }),
      },
      "/api/v1/messages": { patch: operation({ operationId: "updateMessage", summary: "تعديل أو حذف أو استعادة رسالة", tag: "Conversations", body: { type: "object" } }) },
      "/api/v1/chat": { post: operation({ operationId: "sendChatMessage", summary: "إرسال رسالة وتشغيل الوكيل عبر AI SDK", tag: "Conversations", body: { $ref: "#/components/schemas/ChatInput" } }) },
      "/api/v1/runs": {
        get: operation({ operationId: "listRuns", summary: "عرض سجل التشغيل بما فيه waiting_approval", tag: "Runs" }),
        post: operation({ operationId: "createRun", summary: "تشغيل وكيل", tag: "Runs", status: 201, body: { type: "object" } }),
      },
      "/api/v1/teams": {
        get: operation({ operationId: "listAgentTeams", summary: "عرض فرق الوكلاء", tag: "Agent Teams" }),
        post: operation({ operationId: "createAgentTeam", summary: "إنشاء فريق مشرف وعمال", tag: "Agent Teams", status: 201, body: { $ref: "#/components/schemas/TeamCreate" } }),
      },
      "/api/v1/team-runs": {
        get: operation({ operationId: "listTeamRuns", summary: "عرض تشغيلات الفرق وخطواتها", tag: "Agent Teams" }),
        post: { ...operation({ operationId: "createTeamRun", summary: "إضافة تشغيل الفريق إلى Graphile Worker", tag: "Agent Teams", status: 202, body: { $ref: "#/components/schemas/TeamRunCreate" } }), parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 8, maxLength: 100 } }] },
      },
      "/api/v1/team-runs/{teamRunId}": { get: operation({ operationId: "getTeamRun", summary: "قراءة تشغيل فريق وخطوات العمال والمشرف", tag: "Agent Teams", parameters: idPath("teamRunId") }) },
      "/api/v1/team-runs/{teamRunId}/cancel": { post: operation({ operationId: "cancelTeamRun", summary: "طلب إلغاء تشغيل فريق", tag: "Agent Teams", parameters: idPath("teamRunId") }) },
      "/api/v1/team-runs/{teamRunId}/retry": { post: operation({ operationId: "retryTeamRun", summary: "إعادة محاولة تشغيل فريق فاشل بأمان", tag: "Agent Teams", status: 202, parameters: idPath("teamRunId") }) },
      "/api/v1/tool-approvals": { get: operation({ operationId: "listToolApprovals", summary: "عرض الموافقات المعلقة للمؤسسة", tag: "Tool Approvals" }) },
      "/api/v1/tool-approvals/{approvalId}": { get: operation({ operationId: "getToolApproval", summary: "قراءة موافقة ومدخلاتها المنقحة", tag: "Tool Approvals", parameters: approvalPath }) },
      "/api/v1/tool-approvals/{approvalId}/approve": { post: operation({ operationId: "approveToolCall", summary: "الموافقة واستئناف نفس Run عبر Worker", tag: "Tool Approvals", status: 202, parameters: approvalPath, body: { $ref: "#/components/schemas/ApprovalDecision" } }) },
      "/api/v1/tool-approvals/{approvalId}/reject": { post: operation({ operationId: "rejectToolCall", summary: "رفض الأداة واستئناف Run دون تنفيذها", tag: "Tool Approvals", status: 202, parameters: approvalPath, body: { $ref: "#/components/schemas/ApprovalDecision" } }) },
      "/api/v1/files": {
        get: operation({ operationId: "listOrDownloadFiles", summary: "عرض ملف أو تنزيله", tag: "Files" }),
        post: operation({ operationId: "uploadFile", summary: "رفع ملف multipart", tag: "Files", status: 201 }),
      },
      "/api/v1/provider-credentials": {
        get: operation({ operationId: "listProviderCredentials", summary: "عرض المزودات المتحققة دون الأسرار", tag: "Providers" }),
        post: operation({ operationId: "createProviderCredential", summary: "اختبار وحفظ مفتاح مزود مشفر", tag: "Providers", status: 201, body: { type: "object" } }),
      },
      "/api/v1/integrations": { get: operation({ operationId: "listIntegrations", summary: "عرض حالة التكاملات والوكيل المرتبط", tag: "Integrations" }) },
      "/api/v1/github": { post: operation({ operationId: "githubRead", summary: "عرض المستودعات أو قراءة ملف", tag: "Integrations", body: { type: "object" } }) },
      "/api/v1/mcp": {
        get: operation({ operationId: "listMcp", summary: "عرض خوادم وأدوات وموارد وقوالب ومطالبات MCP", tag: "MCP" }),
        post: operation({ operationId: "mutateMcp", summary: "ربط أو مزامنة أو قراءة أو تنفيذ MCP", tag: "MCP", body: { type: "object" } }),
        delete: operation({ operationId: "deleteMcpServer", summary: "حذف اتصال MCP", tag: "MCP" }),
      },
      "/api/v1/youtube": { post: operation({ operationId: "importYoutubeTranscript", summary: "تفريغ YouTube عبر موصل خارجي", tag: "Tools", status: 201, body: { type: "object" } }) },
      "/api/v1/site-audit": { post: operation({ operationId: "auditPublicSite", summary: "فحص دفاعي لصفحة عامة مصرح بها", tag: "Tools", status: 201, body: { type: "object" } }) },
    },
  }, { headers: { "cache-control": "public, max-age=300" } });
}
