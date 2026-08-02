import { z } from "zod";
import {
  SITE_PERMISSION_ACTIONS,
  SITE_PERMISSION_POLICIES,
} from "@/lib/site-connections/policy";

export const sitePermissionActionSchema = z.enum(SITE_PERMISSION_ACTIONS);
export const sitePermissionPolicySchema = z.enum(SITE_PERMISSION_POLICIES);
export const siteConnectorTypeSchema = z.enum(["oauth", "api", "browser"]);
export const siteConnectionIdSchema = z.string().uuid();

const connectorKeySchema = z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/);
const connectionNameSchema = z.string().trim().min(2).max(120);
const domainInputSchema = z.string().trim().min(1).max(253);
const credentialSchema = z.string().trim().min(8).max(8_000);

export const sitePermissionInputSchema = z.object({
  action: sitePermissionActionSchema,
  policy: sitePermissionPolicySchema,
}).strict();

export const agentConnectionInputSchema = z.object({
  agentId: z.string().uuid(),
  enabled: z.boolean().default(true),
  permissions: z.array(sitePermissionInputSchema).max(SITE_PERMISSION_ACTIONS.length).default([]),
}).strict().superRefine((value, context) => {
  const actions = new Set<string>();
  for (const [index, permission] of value.permissions.entries()) {
    if (actions.has(permission.action)) {
      context.addIssue({
        code: "custom",
        path: ["permissions", index, "action"],
        message: "لا يمكن تكرار الصلاحية نفسها.",
      });
    }
    actions.add(permission.action);
  }
});

export const siteConnectionCreateSchema = z.object({
  name: connectionNameSchema,
  siteDomain: domainInputSchema,
  connectorType: siteConnectorTypeSchema,
  connectorKey: connectorKeySchema,
  credential: credentialSchema.optional(),
  allowedDomains: z.array(domainInputSchema).max(20).default([]),
  agents: z.array(agentConnectionInputSchema).max(100).default([]),
}).strict().superRefine((value, context) => {
  if (value.connectorType === "api" && !value.credential) {
    context.addIssue({
      code: "custom",
      path: ["credential"],
      message: "بيانات اعتماد API مطلوبة لهذا النوع من الاتصالات.",
    });
  }
  if (value.connectorType !== "api" && value.credential) {
    context.addIssue({
      code: "custom",
      path: ["credential"],
      message: "لا تُرسل بيانات اعتماد مباشرة لاتصال OAuth أو جلسة متصفح.",
    });
  }
  const agents = new Set<string>();
  for (const [index, assignment] of value.agents.entries()) {
    if (agents.has(assignment.agentId)) {
      context.addIssue({
        code: "custom",
        path: ["agents", index, "agentId"],
        message: "لا يمكن ربط الوكيل نفسه مرتين.",
      });
    }
    agents.add(assignment.agentId);
  }
});

export const siteConnectionUpdateSchema = z.object({
  id: siteConnectionIdSchema,
  name: connectionNameSchema.optional(),
  credential: credentialSchema.optional(),
  allowedDomains: z.array(domainInputSchema).max(20).optional(),
}).strict().refine(
  (value) => value.name !== undefined || value.credential !== undefined || value.allowedDomains !== undefined,
  { message: "يجب إرسال حقل واحد على الأقل للتحديث." },
);

export const siteConnectionDeleteSchema = z.object({
  id: siteConnectionIdSchema,
}).strict();

export const agentSiteConnectionUpsertSchema = z.object({
  connectionId: siteConnectionIdSchema,
  assignment: agentConnectionInputSchema,
}).strict();

export const agentSiteConnectionDeleteSchema = z.object({
  connectionId: siteConnectionIdSchema,
  agentId: z.string().uuid(),
}).strict();
