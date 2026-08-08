import { z } from "zod";

export const runnerKindSchema = z.enum(["existing", "gvisor", "e2b", "daytona"]);
export type RunnerKind = z.infer<typeof runnerKindSchema>;

export const workspaceStateSchema = z.enum([
  "provisioning",
  "ready",
  "running",
  "paused",
  "stopping",
  "stopped",
  "failed",
]);
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;

export const executionStatusSchema = z.enum([
  "queued",
  "provisioning",
  "ready",
  "running",
  "waiting_for_input",
  "waiting_for_approval",
  "cancel_requested",
  "cancelling",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "orphaned",
]);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

export const executionLimitsSchema = z.object({
  timeoutMs: z.number().int().min(1_000).max(1_800_000),
  cpuMillis: z.number().int().positive().max(1_800_000).optional(),
  memoryBytes: z.number().int().min(64 * 1024 * 1024).max(8 * 1024 * 1024 * 1024),
  diskBytes: z.number().int().min(16 * 1024 * 1024).max(20 * 1024 * 1024 * 1024),
  maxProcesses: z.number().int().min(1).max(512),
  maxOutputBytes: z.number().int().min(1_024).max(50 * 1024 * 1024),
  maxArtifactBytes: z.number().int().min(1_024).max(2 * 1024 * 1024 * 1024),
  maxNetworkBytes: z.number().int().nonnegative().max(2 * 1024 * 1024 * 1024).optional(),
  maxFiles: z.number().int().min(1).max(100_000).default(5_000),
  maxSingleFileBytes: z.number().int().min(1_024).max(500 * 1024 * 1024).default(25 * 1024 * 1024),
}).strict();
export type ExecutionLimits = z.infer<typeof executionLimitsSchema>;

export const networkPolicySchema = z.object({
  mode: z.enum(["deny_all", "allowlist"]),
  allowedHosts: z.array(z.string().trim().min(1).max(253)).max(100),
  allowedPorts: z.array(z.number().int().min(1).max(65_535)).max(50),
  allowDns: z.boolean(),
  allowedMethods: z.array(z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])).max(6).default(["GET", "HEAD"]),
  maxRequests: z.number().int().min(0).max(10_000).default(0),
}).strict();
export type NetworkPolicy = z.infer<typeof networkPolicySchema>;

export const commandRequestSchema = z.object({
  argv: z.array(z.string().max(8_192)).min(1).max(128),
  cwd: z.string().trim().min(1).max(1_024),
  stdin: z.string().max(1_048_576).optional(),
  environment: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/), z.string().max(8_192)).optional(),
  timeoutMs: z.number().int().min(1_000).max(1_800_000),
}).strict();
export type CommandRequest = z.infer<typeof commandRequestSchema>;

export type CommandResult = {
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  completedAt: string;
  stdoutBytes: number;
  stderrBytes: number;
  timedOut: boolean;
};

export type RunnerHealth = {
  ok: boolean;
  kind: RunnerKind;
  checkedAt: string;
  latencyMs: number;
  capabilities: {
    command: boolean;
    files: boolean;
    cancellation: boolean;
    networkIsolation: boolean;
    snapshots: boolean;
    pauseResume: boolean;
  };
  errorCode?: string;
};

export interface ExecutionRunner {
  readonly kind: RunnerKind;
  healthCheck(): Promise<RunnerHealth>;
  createWorkspace(input: {
    executionId: string;
    organizationId: string;
    templateId: string;
    limits: ExecutionLimits;
    networkPolicy: NetworkPolicy;
  }): Promise<{ externalWorkspaceId: string; state: WorkspaceState }>;
  executeCommand(
    workspaceId: string,
    input: CommandRequest,
    callbacks: {
      onStdout(chunk: Uint8Array): Promise<void>;
      onStderr(chunk: Uint8Array): Promise<void>;
      onState(state: string): Promise<void>;
    },
  ): Promise<CommandResult>;
  uploadFile(workspaceId: string, destination: string, content: AsyncIterable<Uint8Array>): Promise<void>;
  downloadFile(workspaceId: string, source: string): Promise<AsyncIterable<Uint8Array>>;
  listFiles(workspaceId: string, root: string): Promise<Array<{
    path: string;
    sizeBytes: number;
    type: "file" | "directory";
  }>>;
  terminateProcess(workspaceId: string, processId?: string): Promise<void>;
  destroyWorkspace(workspaceId: string): Promise<void>;
}

export const diagnosticScenarioSchema = z.enum(["success", "failure", "timeout", "secrets"]);
export type DiagnosticScenario = z.infer<typeof diagnosticScenarioSchema>;

export const executionCreateSchema = z.object({
  kind: z.literal("diagnostic.command"),
  idempotencyKey: z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9:_-]+$/),
  input: z.object({ scenario: diagnosticScenarioSchema.default("success") }).strict(),
}).strict();
export type ExecutionCreateInput = z.infer<typeof executionCreateSchema>;

export const executionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: executionStatusSchema.optional(),
}).strict();

export const executionEventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
}).strict();

export const executionArtifactsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const EXECUTION_EVENT_TYPES = [
  "job.created",
  "job.queued",
  "workspace.provisioning",
  "workspace.ready",
  "step.started",
  "process.started",
  "stdout.chunk",
  "stderr.chunk",
  "resource.sample",
  "artifact.discovered",
  "artifact.stored",
  "approval.required",
  "input.required",
  "cancel.requested",
  "process.terminated",
  "step.completed",
  "step.failed",
  "job.completed",
  "job.failed",
  "job.timed_out",
  "job.cancelled",
  "workspace.destroyed",
] as const;
export type ExecutionEventType = typeof EXECUTION_EVENT_TYPES[number];
