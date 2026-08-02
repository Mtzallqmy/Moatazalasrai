import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  sandboxExecutionCreateSchema,
  sandboxFileDeleteSchema,
  sandboxFileListSchema,
  sandboxFileReadSchema,
  sandboxFileWriteSchema,
} from "@/lib/sandbox/contracts";
import {
  cancelSandboxExecution,
  createSandboxExecution,
  createSandboxWorkspace,
  deleteSandboxFile,
  listSandboxFiles,
  readSandboxFile,
  resetSandboxWorkspace,
  writeSandboxFile,
} from "@/lib/sandbox/service";

export type SandboxToolContext = {
  organizationId: string;
  userId: string;
  role: string;
  conversationId: string;
  agentId: string;
  requestId: string;
};

const workspaceIdSchema = z.string().uuid();

export function createSandboxTools(context: SandboxToolContext): ToolSet {
  const actor = { organizationId: context.organizationId, userId: context.userId, role: context.role };
  return {
    "sandbox.create": tool({
      description: "أنشئ أو أعد مساحة Sandbox معزولة للمحادثة الحالية. لا تُنشئها إلا عند الحاجة إلى ملفات أو تنفيذ كود.",
      inputSchema: z.object({ template: z.string().trim().min(1).max(100).default("moataz-code") }).strict(),
      execute: async ({ template }) => createSandboxWorkspace({
        actor,
        requestId: context.requestId,
        body: { conversationId: context.conversationId, agentId: context.agentId, template, permissions: [] },
      }),
    }),
    "sandbox.exec": tool({
      description: "شغّل أمرًا داخل Sandbox المعزول فقط. قد يتوقف التنفيذ لطلب موافقة بشرية.",
      inputSchema: sandboxExecutionCreateSchema.pick({ workspaceId: true, command: true, workingDirectory: true, timeoutMs: true }),
      execute: async (input) => createSandboxExecution({
        actor,
        requestId: context.requestId,
        body: {
          ...input,
          conversationId: context.conversationId,
          agentId: context.agentId,
          idempotencyKey: crypto.randomUUID(),
        },
      }),
    }),
    "sandbox.readFile": tool({
      description: "اقرأ ملفًا داخل مساحة العمل. لا تستخدم مسارات مطلقة أو .. للخروج من المساحة.",
      inputSchema: sandboxFileReadSchema,
      execute: async (input) => readSandboxFile({ actor, ...input }),
    }),
    "sandbox.writeFile": tool({
      description: "اكتب ملفًا داخل مساحة العمل. تمر العملية عبر سياسات Sandbox ولا تعرض أسرارًا.",
      inputSchema: sandboxFileWriteSchema,
      execute: async (input) => writeSandboxFile({ actor, ...input, requestId: context.requestId }),
    }),
    "sandbox.listFiles": tool({
      description: "اعرض شجرة ملفات مساحة العمل ضمن عمق محدود.",
      inputSchema: sandboxFileListSchema,
      execute: async (input) => listSandboxFiles({ actor, ...input }),
    }),
    "sandbox.deleteFile": tool({
      description: "احذف ملفًا أو مجلدًا داخل مساحة العمل. الحذف الواسع ممنوع وقد يتطلب موافقة.",
      inputSchema: sandboxFileDeleteSchema,
      execute: async (input) => deleteSandboxFile({ actor, ...input, requestId: context.requestId }),
    }),
    "sandbox.stopExecution": tool({
      description: "أوقف عملية Sandbox جارية للمحادثة الحالية.",
      inputSchema: z.object({ executionId: z.string().uuid() }).strict(),
      execute: async ({ executionId }) => cancelSandboxExecution({ actor, executionId, requestId: context.requestId }),
    }),
    "sandbox.reset": tool({
      description: "أعد ضبط مساحة Sandbox بعد موافقة المستخدم؛ يحذف ذلك الملفات والحالة الحالية.",
      inputSchema: z.object({ workspaceId: workspaceIdSchema }).strict(),
      execute: async ({ workspaceId }) => resetSandboxWorkspace({ actor, workspaceId, requestId: context.requestId }),
    }),
  } satisfies ToolSet;
}
