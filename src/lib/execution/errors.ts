export type ExecutionErrorCode =
  | "EXECUTION_KERNEL_DISABLED"
  | "EXECUTION_NOT_FOUND"
  | "EXECUTION_INVALID_TRANSITION"
  | "EXECUTION_TERMINAL"
  | "EXECUTION_IDEMPOTENCY_CONFLICT"
  | "EXECUTION_INPUT_NOT_ALLOWED"
  | "EXECUTION_LIMIT_EXCEEDED"
  | "EXECUTION_OUTPUT_LIMIT"
  | "EXECUTION_ARTIFACT_LIMIT"
  | "EXECUTION_PATH_INVALID"
  | "EXECUTION_NETWORK_DENIED"
  | "EXECUTION_RUNNER_UNAVAILABLE"
  | "EXECUTION_RUNNER_PROTOCOL_ERROR"
  | "EXECUTION_RUNNER_TIMEOUT"
  | "EXECUTION_RUNNER_CANCEL_FAILED"
  | "EXECUTION_WORKSPACE_NOT_READY"
  | "EXECUTION_LEASE_UNAVAILABLE"
  | "EXECUTION_GRANT_INVALID"
  | "EXECUTION_GRANT_EXPIRED"
  | "EXECUTION_GRANT_REPLAYED"
  | "EXECUTION_CREDENTIAL_FORBIDDEN"
  | "EXECUTION_ARTIFACT_INVALID"
  | "EXECUTION_ARTIFACT_NOT_FOUND"
  | "EXECUTION_DATABASE_UNAVAILABLE";

export class ExecutionError extends Error {
  readonly name = "ExecutionError";
  constructor(
    readonly code: ExecutionErrorCode,
    message: string,
    readonly retryable = false,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function asExecutionError(error: unknown) {
  if (error instanceof ExecutionError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new ExecutionError("EXECUTION_RUNNER_TIMEOUT", "انتهت مهلة التنفيذ في بيئة التشغيل.", true);
  }
  return new ExecutionError(
    "EXECUTION_RUNNER_UNAVAILABLE",
    "تعذر إكمال التنفيذ في بيئة التشغيل المعزولة.",
    true,
    { errorName: error instanceof Error ? error.name : "UNKNOWN" },
  );
}

export function executionErrorHttpStatus(code: ExecutionErrorCode) {
  if (code === "EXECUTION_NOT_FOUND" || code === "EXECUTION_ARTIFACT_NOT_FOUND") return 404;
  if (code === "EXECUTION_KERNEL_DISABLED") return 404;
  if (code.includes("FORBIDDEN") || code === "EXECUTION_NETWORK_DENIED") return 403;
  if (code.includes("INVALID") || code === "EXECUTION_INPUT_NOT_ALLOWED") return 422;
  if (code.includes("LIMIT")) return 429;
  if (code === "EXECUTION_INVALID_TRANSITION" || code === "EXECUTION_TERMINAL" || code === "EXECUTION_LEASE_UNAVAILABLE") return 409;
  if (code === "EXECUTION_RUNNER_TIMEOUT") return 504;
  return 502;
}
