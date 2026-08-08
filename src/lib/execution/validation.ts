import { posix } from "node:path";
import type { CommandRequest, DiagnosticScenario, ExecutionLimits } from "@/lib/execution/contracts";
import { commandRequestSchema } from "@/lib/execution/contracts";
import { ExecutionError } from "@/lib/execution/errors";

const FORBIDDEN_ENVIRONMENT = /(?:DATABASE_URL|RAILWAY|SECRET|TOKEN|PASSWORD|COOKIE|SESSION|ENCRYPTION|API_KEY|ACCESS_KEY|PRIVATE_KEY)/i;
const SAFE_ENVIRONMENT = new Set(["LANG", "LC_ALL", "TZ", "NO_COLOR", "PYTHONIOENCODING"]);

const diagnosticPrograms: Record<DiagnosticScenario, string> = {
  success: [
    "from pathlib import Path",
    "value = 2 + 2",
    "print(value)",
    "Path('result.txt').write_text(str(value) + '\\n', encoding='utf-8')",
  ].join("; "),
  failure: "import sys; sys.stderr.write('diagnostic failure\\n'); raise SystemExit(7)",
  timeout: "import time; print('started', flush=True); time.sleep(3600)",
  secrets: [
    "import os",
    "from pathlib import Path",
    "blocked = [k for k in os.environ if any(x in k.upper() for x in ('DATABASE','SECRET','TOKEN','PASSWORD','RAILWAY','ENCRYPTION','API_KEY'))]",
    "print('safe' if not blocked else 'leak')",
    "Path('result.txt').write_text('safe\\n' if not blocked else 'leak:' + ','.join(blocked), encoding='utf-8')",
  ].join("; "),
};

export function normalizeWorkspacePath(value: string) {
  if (typeof value !== "string" || value.includes("\0") || value.includes("\\")) {
    throw new ExecutionError("EXECUTION_PATH_INVALID", "مسار مساحة التنفيذ غير صالح.");
  }
  const trimmed = value.trim().replace(/^\/+/, "");
  const normalized = posix.normalize(trimmed || ".");
  if (normalized === ".." || normalized.startsWith("../") || posix.isAbsolute(normalized)) {
    throw new ExecutionError("EXECUTION_PATH_INVALID", "لا يسمح بالخروج من مساحة التنفيذ.");
  }
  if (normalized.split("/").some((part) => part === ".moataz")) {
    throw new ExecutionError("EXECUTION_PATH_INVALID", "المسار محجوز لبيانات تشغيل داخلية.");
  }
  return normalized;
}

export function sanitizeCommandEnvironment(environment: Record<string, string> | undefined) {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment ?? {})) {
    if (!SAFE_ENVIRONMENT.has(key) || FORBIDDEN_ENVIRONMENT.test(key)) {
      throw new ExecutionError("EXECUTION_INPUT_NOT_ALLOWED", `متغير البيئة ${key} غير مسموح داخل بيئة التنفيذ.`);
    }
    safe[key] = value;
  }
  return safe;
}

export function validateCommandRequest(input: CommandRequest) {
  const parsed = commandRequestSchema.parse(input);
  if (parsed.argv.some((argument) => argument.includes("\0"))) {
    throw new ExecutionError("EXECUTION_INPUT_NOT_ALLOWED", "تحتوي وسيطات الأمر على بيانات غير صالحة.");
  }
  const executable = parsed.argv[0];
  if (!new Set(["python", "python3"]).has(executable)) {
    throw new ExecutionError("EXECUTION_INPUT_NOT_ALLOWED", "المرحلة الأولى تسمح ببرنامج التشخيص الثابت فقط.");
  }
  if (parsed.argv[1] !== "-c" || parsed.argv.length !== 3 || !Object.values(diagnosticPrograms).includes(parsed.argv[2])) {
    throw new ExecutionError("EXECUTION_INPUT_NOT_ALLOWED", "لا يسمح بأوامر حرة في المرحلة الأولى.");
  }
  return {
    ...parsed,
    cwd: normalizeWorkspacePath(parsed.cwd),
    environment: sanitizeCommandEnvironment(parsed.environment),
  };
}

export function diagnosticCommand(scenario: DiagnosticScenario, limits: ExecutionLimits) {
  return validateCommandRequest({
    argv: ["python3", "-c", diagnosticPrograms[scenario]],
    cwd: ".",
    timeoutMs: scenario === "timeout" ? Math.min(limits.timeoutMs, 3_000) : limits.timeoutMs,
    environment: {
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PYTHONIOENCODING: "utf-8",
      NO_COLOR: "1",
    },
  });
}

export function diagnosticExpectedArtifact(scenario: DiagnosticScenario) {
  return scenario === "success" || scenario === "secrets" ? "result.txt" : null;
}

export function diagnosticExpectedOutput(scenario: DiagnosticScenario) {
  if (scenario === "success") return "4";
  if (scenario === "secrets") return "safe";
  return null;
}

export function safeFilename(value: string) {
  const name = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim();
  if (!name || name === "." || name === "..") return "artifact.bin";
  return name.slice(0, 180);
}
