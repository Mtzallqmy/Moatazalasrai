export type ApprovalMode = "always" | "never" | "risk_based";
export type ToolRisk = "low" | "medium" | "high";

const SIDE_EFFECT_CAPABILITIES = new Set([
  "write", "delete", "publish", "payment", "send", "execute", "deployment",
  "repository_write", "messaging", "account_management", "media_generation",
]);
const READ_ONLY_CAPABILITIES = new Set([
  "read", "search", "lookup", "list", "fetch", "query", "documentation", "general_read",
]);
const SIDE_EFFECT_LANGUAGE = /\b(delete|remove|write|update|create|publish|deploy|send|email|message|pay|purchase|charge|transfer|execute|run command|commit|push|merge)\b|(?:حذف|تعديل|إنشاء|نشر|إرسال|دفع|تحويل|تنفيذ)/i;
const SENSITIVE_KEY = /secret|password|authorization|cookie|token|api[-_]?key|credential|private[-_]?key/i;

function annotationBoolean(annotations: Record<string, unknown>, key: string) {
  return annotations[key] === true;
}

export function evaluateToolApproval(input: {
  approvalMode: ApprovalMode;
  risk: string;
  capability: string;
  name: string;
  description?: string | null;
  annotations: Record<string, unknown>;
  arguments: Record<string, unknown>;
}) {
  const risk: ToolRisk = input.risk === "low" || input.risk === "high" ? input.risk : "medium";
  const explicitReadOnly = annotationBoolean(input.annotations, "readOnlyHint");
  const explicitDestructive = annotationBoolean(input.annotations, "destructiveHint");
  const explicitOpenWorld = annotationBoolean(input.annotations, "openWorldHint");
  const capability = input.capability.trim().toLowerCase();
  const descriptiveText = `${input.name} ${input.description ?? ""}`;
  const sideEffectful = explicitDestructive
    || SIDE_EFFECT_CAPABILITIES.has(capability)
    || SIDE_EFFECT_LANGUAGE.test(descriptiveText)
    || Object.keys(input.arguments).some((key) => /recipient|destination|amount|payment|commit|branch|publish|delete/i.test(key));
  const readOnly = explicitReadOnly
    || (READ_ONLY_CAPABILITIES.has(capability) && !sideEffectful && !explicitOpenWorld);

  if (input.approvalMode === "always") {
    return { requiresApproval: true, reason: "إعداد الوكيل يطلب موافقة لكل استدعاء.", risk, readOnly, sideEffectful };
  }
  if (sideEffectful) {
    return { requiresApproval: true, reason: "الأداة قد تغيّر حالة خارجية أو ترسل أو تنشر أو تحذف بيانات.", risk, readOnly: false, sideEffectful: true };
  }
  if (input.approvalMode === "risk_based" && (risk === "medium" || risk === "high")) {
    return { requiresApproval: true, reason: `مستوى خطورة الأداة ${risk}.`, risk, readOnly, sideEffectful };
  }
  if ((input.approvalMode === "never" || input.approvalMode === "risk_based") && risk === "low" && readOnly) {
    return { requiresApproval: false, reason: "عملية قراءة منخفضة الخطورة.", risk, readOnly: true, sideEffectful: false };
  }
  return { requiresApproval: true, reason: "لم تثبت الأداة أنها قراءة منخفضة الخطورة؛ تم الإيقاف للموافقة.", risk, readOnly, sideEffectful };
}

export function redactedArgumentSummary(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[nested]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => redactedArgumentSummary(item, depth + 1));
  if (typeof value !== "object") return String(value);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 20).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? "[redacted]" : redactedArgumentSummary(item, depth + 1),
  ]));
}
