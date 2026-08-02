import { z } from "zod";
import {
  SANDBOX_PERMISSION_ACTIONS,
  SANDBOX_PERMISSION_POLICIES,
  normalizeWorkspacePath,
} from "@/lib/sandbox/policy";

export const sandboxWorkspaceIdSchema = z.string().uuid();
export const sandboxExecutionIdSchema = z.string().uuid();
export const sandboxPermissionActionSchema = z.enum(SANDBOX_PERMISSION_ACTIONS);
export const sandboxPermissionPolicySchema = z.enum(SANDBOX_PERMISSION_POLICIES);

const workspaceNameSchema = z.string().trim().min(2).max(120);
const templateSchema = z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/);
const workspacePathSchema = z.string().trim().min(1).max(1_024).transform(normalizeWorkspacePath);

export const sandboxPermissionInputSchema = z.object({
  action: sandboxPermissionActionSchema,
  policy: sandboxPermissionPolicySchema,
}).strict();

export const sandboxWorkspaceCreateSchema = z.object({
  conversationId: z.string().uuid(),
  name: workspaceNameSchema.optional(),
  template: templateSchema.default("moataz-code"),
  agentId: z.string().uuid().optional(),
  permissions: z.array(sandboxPermissionInputSchema).max(SANDBOX_PERMISSION_ACTIONS.length).default([]),
}).strict().superRefine((value, context) => {
  const actions = new Set<string>();
  for (const [index, permission] of value.permissions.entries()) {
    if (actions.has(permission.action)) {
      context.addIssue({ code: "custom", path: ["permissions", index, "action"], message: "لا يمكن تكرار الصلاحية نفسها." });
    }
    actions.add(permission.action);
  }
});

export const sandboxExecutionCreateSchema = z.object({
  workspaceId: sandboxWorkspaceIdSchema,
  conversationId: z.string().uuid(),
  messageId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  command: z.string().trim().min(1).max(20_000),
  workingDirectory: workspacePathSchema.default("."),
  timeoutMs: z.number().int().min(1_000).max(1_800_000).optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export const sandboxExecutionCancelSchema = z.object({
  executionId: sandboxExecutionIdSchema,
}).strict();

export const sandboxWorkspaceActionSchema = z.object({
  workspaceId: sandboxWorkspaceIdSchema,
  action: z.enum(["reset", "terminate"]),
}).strict();

export const sandboxFileListSchema = z.object({
  workspaceId: sandboxWorkspaceIdSchema,
  path: workspacePathSchema.default("."),
  depth: z.coerce.number().int().min(1).max(10).default(4),
}).strict();

export const sandboxFileReadSchema = z.object({
  workspaceId: sandboxWorkspaceIdSchema,
  path: workspacePathSchema,
  maxBytes: z.coerce.number().int().min(1).max(1_048_576).default(262_144),
}).strict();

export const sandboxFileWriteSchema = z.object({
  workspaceId: sandboxWorkspaceIdSchema,
  path: workspacePathSchema,
  content: z.string().max(2_000_000),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
  overwrite: z.boolean().default(false),
}).strict();

export const sandboxFileDeleteSchema = z.object({
  workspaceId: sandboxWorkspaceIdSchema,
  path: workspacePathSchema,
  recursive: z.boolean().default(false),
}).strict();

export const sandboxEventsQuerySchema = z.object({
  executionId: sandboxExecutionIdSchema,
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
}).strict();

export const sandboxToolSchemas = {
  "sandbox.create": sandboxWorkspaceCreateSchema,
  "sandbox.exec": sandboxExecutionCreateSchema,
  "sandbox.readFile": sandboxFileReadSchema,
  "sandbox.writeFile": sandboxFileWriteSchema,
  "sandbox.listFiles": sandboxFileListSchema,
  "sandbox.deleteFile": sandboxFileDeleteSchema,
  "sandbox.downloadArtifact": z.object({ artifactId: z.string().uuid() }).strict(),
  "sandbox.stopExecution": sandboxExecutionCancelSchema,
  "sandbox.reset": z.object({ workspaceId: sandboxWorkspaceIdSchema }).strict(),
} as const;

export type SandboxWorkspaceCreateInput = z.infer<typeof sandboxWorkspaceCreateSchema>;
export type SandboxExecutionCreateInput = z.infer<typeof sandboxExecutionCreateSchema>;
