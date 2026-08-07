import type { Permission } from "@/lib/auth/permissions";

export type ToolCategory = "data" | "coding" | "browser" | "media";
export type ToolRunStatus =
  | "draft"
  | "validating"
  | "queued"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "verifying"
  | "completed"
  | "failed"
  | "timed_out"
  | "cancel_requested"
  | "cancelled";

export type ToolRunActor = {
  organizationId: string;
  userId: string;
  role: string;
};

export type ToolHandlerContext = {
  actor: ToolRunActor;
  toolRunId: string;
  executionJobId: string;
};

export type ToolHandler = (context: ToolHandlerContext) => Promise<void>;

export interface ToolManifest {
  id: string;
  version: string;
  titleAr: string;
  descriptionAr: string;
  category: ToolCategory;
  requiredPermission: Permission;
  requiredModule: string;
  executionKind: string;
  supportedInputs: string[];
  supportedOutputs: string[];
  supportsFiles: boolean;
  supportsStreaming: boolean;
  supportsCancellation: boolean;
  supportsResume: boolean;
  networkPolicy: {
    mode: "deny_all" | "allowlist";
    hosts: string[];
  };
  defaultLimits: {
    timeoutMs: number;
    memoryBytes: number;
    diskBytes: number;
    maxArtifactBytes: number;
  };
  approvalPolicy: {
    requiredForWriteActions: boolean;
    requiredForExternalSideEffects: boolean;
    requiredForPublishing: boolean;
  };
  featureFlag: string;
  handler: ToolHandler;
}

export type ToolAvailability = {
  available: boolean;
  reasons: string[];
};
