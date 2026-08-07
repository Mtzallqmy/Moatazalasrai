export const EXECUTION_JOB_STATUSES = [
  "queued",
  "running",
  "waiting_for_input",
  "waiting_for_approval",
  "verifying",
  "completed",
  "failed",
  "timed_out",
  "cancel_requested",
  "cancelled",
] as const;

export type ExecutionJobStatus = (typeof EXECUTION_JOB_STATUSES)[number];

export type ExecutionNetworkPolicy = {
  mode: "deny_all" | "allowlist";
  hosts: string[];
};

export type ExecutionLimits = {
  timeoutMs: number;
  memoryBytes: number;
  diskBytes: number;
  maxArtifactBytes: number;
  maxOutputBytes: number;
};

export type ExecutionWorkspaceHandle = {
  id: string;
  externalRef: string;
  status: "ready" | "provisioning" | "failed" | "terminated";
};

export type ExecutionCommand = {
  command: string;
  workingDirectory?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type ExecutionCommandResult = {
  status: "completed" | "failed" | "cancelled" | "timed_out";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  stdoutBytes: number;
  stderrBytes: number;
};

export type ExecutionRunnerContext = {
  organizationId: string;
  userId: string;
  executionJobId: string;
  workspaceId: string;
  template: string;
  networkPolicy: ExecutionNetworkPolicy;
  limits: ExecutionLimits;
};

export interface ExecutionRunner {
  readonly kind: string;
  health(): Promise<{ ok: boolean; detail?: string }>;
  provision(context: ExecutionRunnerContext): Promise<ExecutionWorkspaceHandle>;
  execute(context: ExecutionRunnerContext & { externalWorkspaceRef: string; command: ExecutionCommand }): Promise<ExecutionCommandResult>;
  writeFile(context: ExecutionRunnerContext & { externalWorkspaceRef: string; path: string; content: Uint8Array }): Promise<{ path: string; sizeBytes: number; sha256?: string | null }>;
  readFile(context: ExecutionRunnerContext & { externalWorkspaceRef: string; path: string; maxBytes: number }): Promise<{ path: string; content: Uint8Array; sizeBytes: number; sha256?: string | null }>;
  listFiles(context: ExecutionRunnerContext & { externalWorkspaceRef: string; path?: string; depth?: number }): Promise<Array<{ path: string; isDirectory: boolean; sizeBytes: number; mimeType?: string | null; sha256?: string | null }>>;
  cancel(context: ExecutionRunnerContext & { externalWorkspaceRef: string }): Promise<void>;
  cleanup(context: ExecutionRunnerContext & { externalWorkspaceRef: string }): Promise<void>;
}
