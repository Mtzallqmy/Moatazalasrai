import { z } from "zod";

const uuid = z.string().uuid();
const model = z.string().trim().min(1).max(300);

export const puterChatStartSchema = z.object({
  conversationId: uuid,
  message: z.string().trim().min(1).max(12_000),
  model,
  clientRequestId: z.string().uuid(),
}).strict();

export const puterChatFinishSchema = z.object({
  conversationId: uuid,
  executionId: uuid,
  userMessageId: uuid,
  model,
  status: z.enum(["completed", "failed", "cancelled"]),
  content: z.string().max(64_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.status === "completed" && !value.content?.trim()) {
    context.addIssue({ code: "custom", path: ["content"], message: "نص الرد مطلوب عند الإكمال." });
  }
  if (value.status !== "completed" && value.content !== undefined) {
    context.addIssue({ code: "custom", path: ["content"], message: "لا يُقبل نص رد عند الفشل أو الإلغاء." });
  }
});
