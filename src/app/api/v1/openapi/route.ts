import { NextResponse } from "next/server";

const success = {
  "200": { description: "نجاح", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
};

const errors = {
  "400": { description: "طلب غير صالح", content: { "application/json": { schema: { $ref: "#/components/schemas/Failure" } } } },
  "401": { description: "رمز وصول غير صالح أو منتهي" },
  "403": { description: "النطاق أو الصلاحية غير كافيين" },
  "422": { description: "تعذر تنفيذ الطلب بقيمه الحالية" },
  "429": { description: "تجاوز معدل الطلبات" },
};

function jsonBody(schema: Record<string, unknown>) {
  return {
    required: true,
    content: { "application/json": { schema } },
  };
}

function operation(input: {
  operationId: string;
  summary: string;
  tag: string;
  auth?: boolean;
  body?: Record<string, unknown>;
  created?: boolean;
  parameters?: Array<Record<string, unknown>>;
}) {
  return {
    operationId: input.operationId,
    summary: input.summary,
    tags: [input.tag],
    ...(input.auth === false ? { security: [] } : {}),
    ...(input.body ? { requestBody: jsonBody(input.body) } : {}),
    ...(input.parameters ? { parameters: input.parameters } : {}),
    responses: {
      ...(input.created ? { "201": { description: "تم الإنشاء" } } : success),
      ...errors,
    },
  };
}

const uuid = { type: "string", format: "uuid" };
const object = { type: "object", additionalProperties: false };

export function GET() {
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "Moataz AI Platform API",
      version: "2.0.0",
      description: "واجهة REST موثقة للموقع وتطبيق Flutter الأصلي والعملاء الآليين. تطبيق الهاتف يستخدم جلسات جهاز دوّارة ولا يضمّن مفتاح منصة.",
    },
    servers: [{ url: "/", description: "الخادم الحالي" }],
    tags: [
      { name: "Mobile Auth", description: "جلسات قصيرة العمر مرتبطة بالجهاز ومساحة العمل" },
      { name: "Agents" },
      { name: "Conversations" },
      { name: "Runs" },
      { name: "Agent Teams" },
      { name: "Files" },
      { name: "Integrations" },
      { name: "Mobile Workspace" },
      { name: "Tools" },
    ],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "mat_ access token or platform API key",
          description: "رمز جلسة الهاتف القصير أو مفتاح منصة ذي نطاقات.",
        },
      },
      schemas: {
        Success: {
          type: "object",
          required: ["success", "data", "meta"],
          properties: {
            success: { const: true },
            data: {},
            meta: {
              type: "object",
              required: ["requestId"],
              properties: { requestId: { type: "string" } },
            },
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
        TokenPair: {
          ...object,
          required: ["accessToken", "refreshToken", "accessExpiresAt", "refreshExpiresAt"],
          properties: {
            accessToken: { type: "string", pattern: "^mat_" },
            refreshToken: { type: "string", pattern: "^mrt_" },
            accessExpiresAt: { type: "string", format: "date-time" },
            refreshExpiresAt: { type: "string", format: "date-time" },
          },
        },
        ConversationCreate: {
          ...object,
          required: ["agentId"],
          properties: { agentId: uuid, title: { type: "string", maxLength: 120 } },
        },
        ChatInput: {
          ...object,
          required: ["conversationId", "message"],
          properties: {
            conversationId: uuid,
            message: { type: "string", minLength: 1, maxLength: 30000 },
            attachmentIds: { type: "array", items: uuid, maxItems: 5 },
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
        TeamRun: {
          ...object,
          required: ["teamId", "input"],
          properties: { teamId: uuid, input: { type: "string", minLength: 1, maxLength: 20000 } },
        },
      },
    },
    paths: {
      "/api/mobile/v1/auth/login": {
        post: operation({
          operationId: "mobileLogin",
          summary: "تسجيل دخول جهاز واختيار مساحة العمل",
          tag: "Mobile Auth",
          auth: false,
          body: { $ref: "#/components/schemas/MobileLogin" },
        }),
      },
      "/api/mobile/v1/auth/register": {
        post: operation({
          operationId: "mobileRegister",
          summary: "إنشاء حساب عضو وإصدار جلسة جهاز",
          tag: "Mobile Auth",
          auth: false,
          body: { ...object, required: ["name", "email", "password", "deviceId"], properties: {
            name: { type: "string", minLength: 2, maxLength: 100 },
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 12, maxLength: 128 },
            deviceId: { type: "string", minLength: 8 },
            deviceName: { type: "string" },
            rememberSession: { type: "boolean", default: true },
          } },
        }),
      },
      "/api/mobile/v1/auth/refresh": {
        post: operation({
          operationId: "mobileRefresh",
          summary: "تدوير رمزي الوصول والتحديث",
          tag: "Mobile Auth",
          auth: false,
          body: { ...object, required: ["refreshToken"], properties: { refreshToken: { type: "string", pattern: "^mrt_" } } },
        }),
      },
      "/api/mobile/v1/auth/logout": {
        post: operation({
          operationId: "mobileLogout",
          summary: "إبطال جلسة الجهاز",
          tag: "Mobile Auth",
          auth: false,
          body: { ...object, required: ["refreshToken"], properties: { refreshToken: { type: "string", pattern: "^mrt_" } } },
        }),
      },
      "/api/mobile/v1/me": {
        get: operation({ operationId: "mobileMe", summary: "هوية المستخدم ونطاقاته", tag: "Mobile Auth" }),
      },
      "/api/mobile/v1/workspace": {
        get: operation({ operationId: "mobileWorkspace", summary: "المؤسسة والصلاحيات والأعضاء والتدقيق وMCP", tag: "Mobile Workspace" }),
      },
      "/api/v1/agents": {
        get: operation({ operationId: "listAgents", summary: "عرض الوكلاء المنشورين", tag: "Agents" }),
        post: operation({ operationId: "createAgent", summary: "إنشاء وكيل", tag: "Agents", created: true, body: { type: "object" } }),
      },
      "/api/v1/agent-templates": {
        get: operation({ operationId: "listAgentTemplates", summary: "عرض مكتبة الوكلاء الإنتاجية", tag: "Agents" }),
        post: operation({ operationId: "installAgentTemplate", summary: "تثبيت قالب وربطه بمزود متحقق", tag: "Agents", created: true, body: { type: "object" } }),
      },
      "/api/v1/conversations": {
        get: operation({
          operationId: "listConversations",
          summary: "عرض المحادثات أو رسائل محادثة",
          tag: "Conversations",
          parameters: [{ name: "conversationId", in: "query", schema: uuid }],
        }),
        post: operation({
          operationId: "createConversation",
          summary: "إنشاء محادثة",
          tag: "Conversations",
          created: true,
          body: { $ref: "#/components/schemas/ConversationCreate" },
        }),
        patch: operation({ operationId: "updateConversation", summary: "تعديل حالة المحادثة", tag: "Conversations", body: { type: "object" } }),
        delete: operation({ operationId: "deleteConversation", summary: "حذف محادثة حذفًا منطقيًا", tag: "Conversations", body: { type: "object" } }),
      },
      "/api/v1/messages": {
        patch: operation({ operationId: "updateMessage", summary: "تعديل أو حذف أو استعادة رسالة", tag: "Conversations", body: { type: "object" } }),
      },
      "/api/v1/chat": {
        post: operation({ operationId: "sendChatMessage", summary: "إرسال رسالة وتشغيل الوكيل", tag: "Conversations", body: { $ref: "#/components/schemas/ChatInput" } }),
      },
      "/api/v1/runs": {
        get: operation({ operationId: "listRuns", summary: "عرض سجل التشغيل", tag: "Runs" }),
        post: operation({ operationId: "createRun", summary: "تشغيل وكيل", tag: "Runs", created: true, body: { type: "object" } }),
      },
      "/api/v1/teams": {
        get: operation({ operationId: "listAgentTeams", summary: "عرض فرق الوكلاء", tag: "Agent Teams" }),
        post: operation({ operationId: "createAgentTeam", summary: "إنشاء فريق مشرف وعمال", tag: "Agent Teams", created: true, body: { $ref: "#/components/schemas/TeamCreate" } }),
      },
      "/api/v1/team-runs": {
        get: operation({ operationId: "listTeamRuns", summary: "عرض تشغيلات الفرق وخطواتها", tag: "Agent Teams" }),
        post: {
          ...operation({ operationId: "createTeamRun", summary: "تشغيل أعضاء الفريق بالتوازي ثم توليف المشرف", tag: "Agent Teams", created: true, body: { $ref: "#/components/schemas/TeamRun" } }),
          parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 8, maxLength: 100 } }],
        },
      },
      "/api/v1/files": {
        get: operation({ operationId: "listOrDownloadFiles", summary: "عرض ملف أو تنزيله", tag: "Files" }),
        post: operation({ operationId: "uploadFile", summary: "رفع ملف multipart", tag: "Files", created: true }),
      },
      "/api/v1/integrations": {
        get: operation({ operationId: "listIntegrations", summary: "عرض حالة التكاملات", tag: "Integrations" }),
      },
      "/api/v1/github": {
        post: operation({ operationId: "githubRead", summary: "عرض المستودعات أو قراءة ملف", tag: "Integrations", body: { type: "object" } }),
      },
      "/api/v1/mcp": {
        get: operation({ operationId: "listMcp", summary: "عرض خوادم وأدوات MCP المكتشفة", tag: "Tools" }),
        post: operation({ operationId: "mutateMcp", summary: "ربط أو مزامنة أو اختبار أداة MCP", tag: "Tools", body: { type: "object" } }),
        delete: operation({ operationId: "deleteMcpServer", summary: "حذف اتصال MCP", tag: "Tools" }),
      },
      "/api/v1/youtube": {
        post: operation({ operationId: "importYoutubeTranscript", summary: "تفريغ YouTube إلى مرفق محادثة عبر موصل خارجي", tag: "Tools", created: true, body: { type: "object" } }),
      },
      "/api/v1/site-audit": {
        post: operation({ operationId: "auditPublicSite", summary: "فحص دفاعي لصفحة عامة مصرح بها", tag: "Tools", created: true, body: { type: "object" } }),
      },
    },
  }, { headers: { "cache-control": "public, max-age=300" } });
}
