import { z } from "zod";
import type { Permission } from "@/lib/auth/permissions";

export const toolIds = ["data.interpreter", "coding.agent", "browser.agent", "voice.studio"] as const;
export type ToolId = typeof toolIds[number];

export const toolCategorySchema = z.enum(["data", "coding", "browser", "media"]);
export const toolExecutionKindSchema = z.enum(["execution_kernel", "provider"]);
export const toolNetworkPolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("deny_all") }),
  z.object({ mode: z.literal("allowlist"), hosts: z.array(z.string().min(1).max(253)).max(50) }),
]);

export const toolApprovalPolicySchema = z.object({ write: z.boolean(), external: z.boolean(), publishing: z.boolean() });
export const toolDefaultLimitsSchema = z.object({
  timeoutMs: z.number().int().positive().max(1_800_000),
  memoryBytes: z.number().int().positive(),
  diskBytes: z.number().int().positive(),
  maxArtifactBytes: z.number().int().positive(),
});

export type ToolManifest = {
  id: ToolId; version: string; titleAr: string; descriptionAr: string;
  category: z.infer<typeof toolCategorySchema>; requiredPermission: Permission; requiredModule: string;
  executionKind: z.infer<typeof toolExecutionKindSchema>; supportedInputs: readonly string[]; supportedOutputs: readonly string[];
  supportsFiles: boolean; supportsStreaming: boolean; supportsCancellation: boolean; supportsResume: boolean;
  networkPolicy: z.infer<typeof toolNetworkPolicySchema>; defaultLimits: z.infer<typeof toolDefaultLimitsSchema>;
  approvalPolicy: z.infer<typeof toolApprovalPolicySchema>; featureFlag: string;
};

export const toolRunStatusSchema = z.enum(["draft","validating","queued","running","waiting_for_input","waiting_for_approval","verifying","completed","failed","timed_out","cancel_requested","cancelled"]);
export type ToolRunStatus = z.infer<typeof toolRunStatusSchema>;

export const createToolRunSchema = z.object({
  title: z.string().trim().min(1).max(300),
  idempotencyKey: z.string().trim().min(8).max(200),
  inputs: z.array(z.object({
    kind: z.string().trim().min(1).max(80), artifactId: z.string().uuid().optional(), value: z.unknown().optional(), sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  }).refine((value) => value.artifactId !== undefined || value.value !== undefined, { message: "Each input must reference an artifact or contain a value." })).max(100).default([]),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type CreateToolRunInput = z.infer<typeof createToolRunSchema>;

export const toolRunInputSchema = z.object({ content: z.string().trim().min(1).max(262_144), metadata: z.record(z.string(), z.unknown()).default({}) });
export const toolRunApprovalDecisionSchema = z.object({ reason: z.string().trim().max(2000).optional() });
