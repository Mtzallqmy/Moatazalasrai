import path from "node:path";
import { ApiError } from "@/lib/http/api";

export const SANDBOX_PERMISSION_ACTIONS = [
  "create",
  "exec",
  "read_file",
  "write_file",
  "delete_file",
  "list_files",
  "upload_file",
  "download_artifact",
  "stop_execution",
  "reset",
  "network",
] as const;
export const SANDBOX_PERMISSION_POLICIES = ["allow", "require_approval", "deny"] as const;
export const SANDBOX_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

export type SandboxPermissionAction = (typeof SANDBOX_PERMISSION_ACTIONS)[number];
export type SandboxPermissionPolicy = (typeof SANDBOX_PERMISSION_POLICIES)[number];
export type SandboxRiskLevel = (typeof SANDBOX_RISK_LEVELS)[number];

export const DEFAULT_SANDBOX_POLICIES: Readonly<Record<SandboxPermissionAction, SandboxPermissionPolicy>> = {
  create: "allow",
  exec: "require_approval",
  read_file: "allow",
  write_file: "require_approval",
  delete_file: "require_approval",
  list_files: "allow",
  upload_file: "require_approval",
  download_artifact: "require_approval",
  stop_execution: "allow",
  reset: "require_approval",
  network: "deny",
};

type CommandAnalysis = {
  risk: SandboxRiskLevel;
  reasons: string[];
  capabilities: string[];
  requiresNetwork: boolean;
  destructive: boolean;
  secretAccess: boolean;
  longRunning: boolean;
};

export type SandboxPolicyDecision = {
  outcome: "allow" | "require_approval" | "deny";
  action: SandboxPermissionAction;
  policy: SandboxPermissionPolicy;
  risk: SandboxRiskLevel;
  reasons: string[];
  capabilities: string[];
};

const NETWORK_COMMANDS = new Set([
  "curl", "wget", "ssh", "scp", "sftp", "rsync", "nc", "ncat", "telnet",
  "ftp", "git", "npm", "pnpm", "yarn", "pip", "pip3", "uv", "apt", "apt-get",
  "apk", "dnf", "yum", "cargo", "go",
]);
const DESTRUCTIVE_COMMANDS = new Set([
  "rm", "rmdir", "shred", "truncate", "dd", "mkfs", "wipefs", "fdisk", "parted",
]);
const PRIVILEGE_COMMANDS = new Set([
  "sudo", "su", "doas", "mount", "umount", "nsenter", "unshare", "chroot",
  "systemctl", "service", "modprobe", "insmod", "rmmod", "iptables", "nft",
]);
const LONG_RUNNING_COMMANDS = new Set([
  "watch", "tail", "top", "htop", "serve", "http-server", "nodemon", "next", "vite",
]);
const SECRET_PATH = /(^|\/)(\.env(?:\.|$)|\.ssh|\.aws|\.config\/gcloud|credentials?|secrets?|id_rsa|id_ed25519)(\/|$)/i;
const AUTHORIZATION_VALUE = /\bauthorization\s*:\s*[^\r\n]+/gi;
const COOKIE_VALUE = /\bcookie\s*:\s*[^\r\n]+/gi;
const BEARER_VALUE = /\bbearer\s+[a-z0-9._~+/=-]+/gi;
const SECRET_ASSIGNMENT = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|token)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s;]+)/gi;

function tokenizeShell(command: string) {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const character of command) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    if ([";", "|", "&", "<", ">"].includes(character)) {
      if (current) tokens.push(current);
      tokens.push(character);
      current = "";
      continue;
    }
    current += character;
  }
  if (current) tokens.push(current);
  return tokens;
}

function maxRisk(left: SandboxRiskLevel, right: SandboxRiskLevel): SandboxRiskLevel {
  const order: SandboxRiskLevel[] = ["low", "medium", "high", "critical"];
  return order[Math.max(order.indexOf(left), order.indexOf(right))]!;
}

export function redactSandboxText(value: string, maximum = 1_000) {
  return value
    .replace(AUTHORIZATION_VALUE, "authorization: [redacted]")
    .replace(COOKIE_VALUE, "cookie: [redacted]")
    .replace(BEARER_VALUE, "Bearer [redacted]")
    .replace(SECRET_ASSIGNMENT, "$1=[redacted]")
    .slice(0, maximum);
}

export function summarizeSandboxCommand(command: string) {
  return redactSandboxText(command.replace(/\s+/g, " ").trim(), 500);
}

export function normalizeWorkspacePath(value: string) {
  if (value.includes("\0") || value.includes("\\")) {
    throw new ApiError(400, "SANDBOX_PATH_INVALID", "مسار الملف غير صالح.");
  }
  const raw = value.trim().replace(/^\/+/, "");
  const normalized = path.posix.normalize(raw || ".");
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new ApiError(400, "SANDBOX_PATH_TRAVERSAL", "لا يمكن الوصول خارج مساحة العمل.");
  }
  if (normalized.length > 1_024) {
    throw new ApiError(400, "SANDBOX_PATH_TOO_LONG", "مسار الملف أطول من الحد المسموح.");
  }
  return normalized;
}

export function analyzeSandboxCommand(command: string, timeoutMs: number): CommandAnalysis {
  const normalized = command.trim();
  if (!normalized || normalized.length > 20_000) {
    throw new ApiError(400, "SANDBOX_COMMAND_INVALID", "الأمر فارغ أو أطول من الحد المسموح.");
  }
  if (/\u0000/.test(normalized)) {
    throw new ApiError(400, "SANDBOX_COMMAND_INVALID", "الأمر يحتوي على محارف غير صالحة.");
  }

  const tokens = tokenizeShell(normalized);
  const commands = tokens.filter((token, index) => index === 0 || [";", "|", "&"].includes(tokens[index - 1] ?? ""));
  const lowered = tokens.map((token) => token.toLowerCase());
  let risk: SandboxRiskLevel = "low";
  const reasons = new Set<string>();
  const capabilities = new Set<string>(["exec"]);
  let requiresNetwork = false;
  let destructive = false;
  let secretAccess = false;
  let longRunning = false;

  if (normalized.includes("`") || normalized.includes("$(") || normalized.includes("<(") || normalized.includes(">(")) {
    risk = maxRisk(risk, "medium");
    reasons.add("dynamic_shell_expansion");
  }
  if (/\s&\s*$/.test(normalized) || lowered.includes("nohup")) {
    longRunning = true;
    risk = maxRisk(risk, "high");
    reasons.add("detached_or_background_process");
  }
  if (tokens.filter((token) => token === ";" || token === "|" || token === "&").length > 4) {
    risk = maxRisk(risk, "medium");
    reasons.add("compound_command");
  }

  for (const commandToken of commands) {
    const base = path.posix.basename(commandToken).toLowerCase();
    if (PRIVILEGE_COMMANDS.has(base)) {
      risk = "critical";
      reasons.add("privilege_or_namespace_change");
      capabilities.add("environment_admin");
    }
    if (NETWORK_COMMANDS.has(base)) {
      requiresNetwork = true;
      risk = maxRisk(risk, base === "git" ? "medium" : "high");
      reasons.add("network_or_package_source");
      capabilities.add("network");
    }
    if (DESTRUCTIVE_COMMANDS.has(base)) {
      destructive = true;
      risk = maxRisk(risk, "high");
      reasons.add("destructive_filesystem_change");
      capabilities.add("delete_file");
    }
    if (LONG_RUNNING_COMMANDS.has(base)) {
      longRunning = true;
      risk = maxRisk(risk, "medium");
      reasons.add("long_running_process");
    }
    if (base === "env" || base === "printenv" || base === "set") {
      secretAccess = true;
      risk = "critical";
      reasons.add("environment_variable_access");
      capabilities.add("secret_access");
    }
  }

  if (lowered.some((token) => SECRET_PATH.test(token)) || /\/proc\/[^\s]+\/environ/i.test(normalized)) {
    secretAccess = true;
    risk = "critical";
    reasons.add("credential_path_access");
    capabilities.add("secret_access");
  }
  if (/\brm\b[^\n]*(--no-preserve-root|\s-rf?\s+\/?(?:\s|$)|\s-rf?\s+\.\.?\/)/i.test(normalized)
    || /\bfind\b[^\n]*\s-delete(?:\s|$)/i.test(normalized)) {
    destructive = true;
    risk = "critical";
    reasons.add("broad_delete");
  }
  if (/\b(chmod|chown)\b[^\n]*(\/|\.\.)/i.test(normalized)) {
    risk = "critical";
    reasons.add("permission_change_outside_workspace");
  }
  if (timeoutMs > 10 * 60_000) {
    longRunning = true;
    risk = maxRisk(risk, "high");
    reasons.add("extended_timeout");
  }

  return {
    risk,
    reasons: [...reasons],
    capabilities: [...capabilities],
    requiresNetwork,
    destructive,
    secretAccess,
    longRunning,
  };
}

export function evaluateSandboxPolicy(input: {
  action: SandboxPermissionAction;
  configuredPolicy?: SandboxPermissionPolicy;
  command?: string;
  timeoutMs?: number;
  networkMode?: string;
}): SandboxPolicyDecision {
  const policy = input.configuredPolicy ?? DEFAULT_SANDBOX_POLICIES[input.action];
  const analysis = input.command
    ? analyzeSandboxCommand(input.command, input.timeoutMs ?? 300_000)
    : { risk: "low" as const, reasons: [], capabilities: [input.action], requiresNetwork: false, destructive: false, secretAccess: false, longRunning: false };

  if (
    analysis.secretAccess
    || analysis.capabilities.includes("environment_admin")
    || analysis.reasons.includes("broad_delete")
    || analysis.reasons.includes("permission_change_outside_workspace")
  ) {
    return {
      outcome: "deny",
      action: input.action,
      policy: "deny",
      risk: "critical",
      reasons: analysis.reasons,
      capabilities: analysis.capabilities,
    };
  }
  if (analysis.requiresNetwork && input.networkMode !== "allowlist") {
    return {
      outcome: "deny",
      action: input.action,
      policy: "deny",
      risk: analysis.risk,
      reasons: [...analysis.reasons, "network_disabled"],
      capabilities: analysis.capabilities,
    };
  }
  if (policy === "deny") {
    return {
      outcome: "deny",
      action: input.action,
      policy,
      risk: analysis.risk,
      reasons: ["configured_policy_denied", ...analysis.reasons],
      capabilities: analysis.capabilities,
    };
  }
  if (
    policy === "require_approval"
    || analysis.risk === "high"
    || analysis.risk === "critical"
    || analysis.destructive
    || analysis.longRunning
  ) {
    return {
      outcome: "require_approval",
      action: input.action,
      policy: "require_approval",
      risk: analysis.risk,
      reasons: analysis.reasons,
      capabilities: analysis.capabilities,
    };
  }
  return {
    outcome: "allow",
    action: input.action,
    policy: "allow",
    risk: analysis.risk,
    reasons: analysis.reasons,
    capabilities: analysis.capabilities,
  };
}
