function integerEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

export function maxModelStepsPerRun() {
  return integerEnv("MAX_MODEL_STEPS_PER_RUN", 8, 1, 16);
}

export function maxTotalToolCallsPerRun() {
  return integerEnv("MAX_TOTAL_TOOL_CALLS_PER_RUN", 12, 1, 32);
}

export function toolApprovalTtlSeconds() {
  return integerEnv("TOOL_APPROVAL_TTL_SECONDS", 900, 60, 86_400);
}

export function runCheckpointTtlSeconds() {
  return integerEnv("RUN_CHECKPOINT_TTL_SECONDS", 86_400, 300, 604_800);
}
