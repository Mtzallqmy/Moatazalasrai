import { z } from "zod";
import {
  BROWSER_RISK_LEVELS,
  SITE_PERMISSION_ACTIONS,
} from "@/lib/site-connections/policy";

export const browserTargetSchema = z.object({
  testId: z.string().trim().min(1).max(200).optional(),
  role: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(300).optional(),
  label: z.string().trim().min(1).max(300).optional(),
  text: z.string().trim().min(1).max(300).optional(),
  css: z.string().trim().min(1).max(500).optional(),
  cssJustification: z.string().trim().min(10).max(300).optional(),
}).strict().superRefine((value, context) => {
  if (!value.testId && !value.role && !value.label && !value.text && !value.css) {
    context.addIssue({ code: "custom", message: "يجب تحديد عنصر الصفحة بمحدد ثابت." });
  }
  if (value.role && !value.name) {
    context.addIssue({ code: "custom", path: ["name"], message: "يتطلب محدد ARIA role اسمًا قابلًا للوصول." });
  }
  if (value.css && !value.cssJustification) {
    context.addIssue({ code: "custom", path: ["cssJustification"], message: "يجب توضيح سبب اللجوء إلى CSS selector." });
  }
});

export const browserStepActionSchema = z.enum([
  "navigate",
  "click",
  "fill",
  "select",
  "upload",
  "read",
  "extract",
  "submit",
  "download",
]);

const permissionSchema = z.enum(SITE_PERMISSION_ACTIONS);
const riskSchema = z.enum(BROWSER_RISK_LEVELS);

const allowedPermissions: Record<z.infer<typeof browserStepActionSchema>, readonly z.infer<typeof permissionSchema>[]> = {
  navigate: ["navigate"],
  click: ["navigate", "update", "delete", "send", "publish", "invite_users", "purchase", "payment", "account_settings", "security_settings"],
  fill: ["fill_form"],
  select: ["fill_form"],
  upload: ["upload"],
  read: ["read"],
  extract: ["read", "search"],
  submit: ["create", "update", "send", "publish", "delete", "invite_users", "purchase", "payment", "account_settings", "security_settings"],
  download: ["download"],
};

export const browserPlanStepSchema = z.object({
  id: z.string().trim().min(1).max(100),
  action: browserStepActionSchema,
  target: browserTargetSchema.optional(),
  url: z.string().url().max(2_000).optional(),
  value: z.string().max(20_000).optional(),
  option: z.string().max(1_000).optional(),
  fileArtifactId: z.string().uuid().optional(),
  requiredPermission: permissionSchema,
  risk: riskSchema,
  expectedResult: z.string().trim().min(1).max(1_000),
}).strict().superRefine((value, context) => {
  if (!allowedPermissions[value.action].includes(value.requiredPermission)) {
    context.addIssue({ code: "custom", path: ["requiredPermission"], message: "الصلاحية لا تطابق نوع خطوة المتصفح." });
  }
  if (value.action === "navigate" && !value.url) {
    context.addIssue({ code: "custom", path: ["url"], message: "خطوة التنقل تتطلب URL." });
  }
  if (value.action !== "navigate" && !value.target) {
    context.addIssue({ code: "custom", path: ["target"], message: "الخطوة تتطلب عنصرًا مستهدفًا." });
  }
  if (value.action === "fill" && value.value === undefined) {
    context.addIssue({ code: "custom", path: ["value"], message: "خطوة تعبئة الحقل تتطلب قيمة." });
  }
  if (value.action === "select" && value.option === undefined) {
    context.addIssue({ code: "custom", path: ["option"], message: "خطوة الاختيار تتطلب خيارًا." });
  }
  if (value.action === "upload" && !value.fileArtifactId) {
    context.addIssue({ code: "custom", path: ["fileArtifactId"], message: "خطوة الرفع تتطلب ملفًا مصرحًا به." });
  }
  if (["payment", "purchase", "security_settings"].includes(value.requiredPermission) && value.risk !== "critical") {
    context.addIssue({ code: "custom", path: ["risk"], message: "الإجراء الحرج يجب تصنيفه critical." });
  }
});

export const browserPlanSchema = z.object({
  connectionId: z.string().uuid(),
  objective: z.string().trim().min(1).max(2_000),
  steps: z.array(browserPlanStepSchema).min(1).max(50),
}).strict().superRefine((value, context) => {
  const ids = new Set<string>();
  for (const [index, step] of value.steps.entries()) {
    if (ids.has(step.id)) {
      context.addIssue({ code: "custom", path: ["steps", index, "id"], message: "معرف الخطوة مكرر." });
    }
    ids.add(step.id);
  }
});

export const browserTaskCreateSchema = z.object({
  agentId: z.string().uuid(),
  connectionId: z.string().uuid(),
  instruction: z.string().trim().min(1).max(4_000),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export const browserTaskCancelSchema = z.object({ browserTaskId: z.string().uuid() }).strict();

export const browserLoginStartSchema = z.object({
  name: z.string().trim().min(2).max(120),
  siteDomain: z.string().trim().min(1).max(253),
  allowedDomains: z.array(z.string().trim().min(1).max(253)).max(20).default([]),
}).strict();

export type BrowserPlan = z.infer<typeof browserPlanSchema>;
export type BrowserPlanStep = z.infer<typeof browserPlanStepSchema>;
