import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  cancelBrowserTask,
  createBrowserTask,
  getBrowserTask,
} from "@/lib/browser/task-service";

export type BrowserToolContext = {
  organizationId: string;
  userId: string;
  role: string;
  agentId: string;
  runId: string;
  state?: {
    toolExecuted: boolean;
    toolResultSaved: boolean;
    sideEffectOccurred: boolean;
  };
};

function operationKey(context: BrowserToolContext, toolCallId: string, operation: string) {
  return `${operation}:${context.runId}:${toolCallId}`;
}

async function executeTracked<T>(context: BrowserToolContext, sideEffectful: boolean, operation: () => Promise<T>) {
  if (context.state) {
    context.state.toolExecuted = true;
    context.state.sideEffectOccurred ||= sideEffectful;
  }
  const result = await operation();
  if (context.state) context.state.toolResultSaved = true;
  return result;
}

export function createBrowserTools(context: BrowserToolContext): ToolSet {
  return {
    "browser.start": tool({
      description: "أنشئ مهمة متصفح غير متزامنة على اتصال موثق مرتبط بالوكيل. تعود المهمة فورًا بحالة queued ويكملها Graphile Worker.",
      inputSchema: z.object({
        connectionId: z.string().uuid(),
        instruction: z.string().trim().min(1).max(4_000),
      }).strict(),
      execute: async (input, options) => executeTracked(context, true, async () => {
        const task = await createBrowserTask({
          organizationId: context.organizationId,
          userId: context.userId,
          requestId: operationKey(context, options.toolCallId, "browser-start-request"),
          body: {
            agentId: context.agentId,
            connectionId: input.connectionId,
            instruction: input.instruction,
            idempotencyKey: operationKey(context, options.toolCallId, "browser-start"),
          },
        });
        return {
          status: "waiting_tool" as const,
          browserTaskId: task.id,
          browserStatus: task.status,
          message: "تم تحويل التنفيذ إلى عامل المتصفح. افحص الحالة قبل استخدام النتيجة.",
        };
      }),
    }),
    "browser.status": tool({
      description: "اقرأ حالة ونتيجة وخطوات مهمة متصفح تابعة للمؤسسة الحالية.",
      inputSchema: z.object({ browserTaskId: z.string().uuid() }).strict(),
      execute: async ({ browserTaskId }) => executeTracked(context, false, () => getBrowserTask({
        organizationId: context.organizationId,
        userId: context.userId,
        role: context.role,
        browserTaskId,
      })),
    }),
    "browser.cancel": tool({
      description: "اطلب إلغاء مهمة متصفح جارية عبر حالة الإلغاء المشتركة في PostgreSQL.",
      inputSchema: z.object({ browserTaskId: z.string().uuid() }).strict(),
      execute: async ({ browserTaskId }, options) => executeTracked(context, true, () => cancelBrowserTask({
        organizationId: context.organizationId,
        userId: context.userId,
        role: context.role,
        browserTaskId,
        requestId: operationKey(context, options.toolCallId, "browser-cancel"),
      })),
    }),
  } satisfies ToolSet;
}
