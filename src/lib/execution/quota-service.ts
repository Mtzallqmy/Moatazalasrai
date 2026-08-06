import { executionLimitsSchema, type ExecutionLimits } from "@/lib/execution/contracts";

function integer(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function platformExecutionLimits(): ExecutionLimits {
  return executionLimitsSchema.parse({
    timeoutMs: integer("EXECUTION_DEFAULT_TIMEOUT_MS", 300_000),
    cpuMillis: integer("EXECUTION_DEFAULT_TIMEOUT_MS", 300_000),
    memoryBytes: integer("EXECUTION_DEFAULT_MEMORY_BYTES", 536_870_912),
    diskBytes: integer("EXECUTION_DEFAULT_DISK_BYTES", 1_073_741_824),
    maxProcesses: integer("EXECUTION_DEFAULT_MAX_PROCESSES", 64),
    maxOutputBytes: integer("EXECUTION_DEFAULT_MAX_OUTPUT_BYTES", 5_242_880),
    maxArtifactBytes: integer("EXECUTION_DEFAULT_MAX_ARTIFACT_BYTES", 104_857_600),
    maxNetworkBytes: 0,
    maxFiles: 5_000,
    maxSingleFileBytes: 26_214_400,
  });
}

const numericKeys: Array<keyof ExecutionLimits> = [
  "timeoutMs",
  "cpuMillis",
  "memoryBytes",
  "diskBytes",
  "maxProcesses",
  "maxOutputBytes",
  "maxArtifactBytes",
  "maxNetworkBytes",
  "maxFiles",
  "maxSingleFileBytes",
];

export function mergeExecutionLimits(...layers: Array<Partial<ExecutionLimits> | null | undefined>): ExecutionLimits {
  const base = platformExecutionLimits();
  const result: Record<string, number> = { ...base } as Record<string, number>;
  for (const layer of layers) {
    if (!layer) continue;
    for (const key of numericKeys) {
      const value = layer[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        const current = result[key];
        result[key] = current === undefined ? value : Math.min(current, value);
      }
    }
  }
  return executionLimitsSchema.parse(result);
}

export function assertUsageWithinLimits(input: {
  limits: ExecutionLimits;
  stdoutBytes?: number;
  stderrBytes?: number;
  artifactBytes?: number;
  diskBytes?: number;
  memoryBytes?: number;
  processes?: number;
  runtimeMs?: number;
}) {
  const output = (input.stdoutBytes ?? 0) + (input.stderrBytes ?? 0);
  if (output > input.limits.maxOutputBytes) return "EXECUTION_OUTPUT_LIMIT" as const;
  if ((input.artifactBytes ?? 0) > input.limits.maxArtifactBytes) return "EXECUTION_ARTIFACT_LIMIT" as const;
  if ((input.diskBytes ?? 0) > input.limits.diskBytes) return "EXECUTION_DISK_LIMIT" as const;
  if ((input.memoryBytes ?? 0) > input.limits.memoryBytes) return "EXECUTION_MEMORY_LIMIT" as const;
  if ((input.processes ?? 0) > input.limits.maxProcesses) return "EXECUTION_PROCESS_LIMIT" as const;
  if ((input.runtimeMs ?? 0) > input.limits.timeoutMs) return "EXECUTION_TIMEOUT" as const;
  return null;
}
