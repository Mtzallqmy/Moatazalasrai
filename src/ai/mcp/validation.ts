import { createHash } from "node:crypto";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { ApiError } from "@/lib/http/api";

const MAX_DEPTH = 12;
const MAX_NODES = 2_000;
const MAX_STRING_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 512 * 1024;

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
  validateFormats: false,
});

const validators = new Map<string, ValidateFunction>();

function schemaKey(schemaHash: string, direction: "input" | "output") {
  return `${direction}:${schemaHash}`;
}

function validator(schema: Record<string, unknown>, schemaHash: string, direction: "input" | "output") {
  const key = schemaKey(schemaHash, direction);
  const cached = validators.get(key);
  if (cached) return cached;
  try {
    const compiled = ajv.compile(schema);
    if (validators.size >= 500) validators.delete(validators.keys().next().value ?? "");
    validators.set(key, compiled);
    return compiled;
  } catch {
    throw new ApiError(422, "MCP_TOOL_SCHEMA_INVALID", "مخطط أداة MCP غير صالح ولا يمكن تنفيذه بأمان.");
  }
}

function safeErrorSummary(errors: ErrorObject[] | null | undefined) {
  return (errors ?? []).slice(0, 5).map((error) => ({
    path: error.instancePath || "/",
    keyword: error.keyword,
  }));
}

export function assertMcpJsonLimits(value: unknown) {
  let nodes = 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (stack.length) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_NODES || current.depth > MAX_DEPTH) {
      throw new ApiError(413, "MCP_PAYLOAD_COMPLEXITY_EXCEEDED", "بيانات MCP تتجاوز حدود العمق أو التعقيد المسموح.");
    }
    if (typeof current.value === "string" && Buffer.byteLength(current.value, "utf8") > MAX_STRING_BYTES) {
      throw new ApiError(413, "MCP_PAYLOAD_STRING_TOO_LARGE", "تحتوي بيانات MCP على نص أكبر من الحد المسموح.");
    }
    if (Array.isArray(current.value)) {
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 });
    } else if (current.value && typeof current.value === "object") {
      for (const item of Object.values(current.value)) stack.push({ value: item, depth: current.depth + 1 });
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > MAX_JSON_BYTES) {
    throw new ApiError(413, "MCP_PAYLOAD_TOO_LARGE", "حجم بيانات MCP يتجاوز الحد المسموح.");
  }
  return bytes;
}

export function validateMcpToolInput(schema: Record<string, unknown>, schemaHash: string, value: unknown) {
  assertMcpJsonLimits(value);
  const validate = validator(schema, schemaHash, "input");
  if (!validate(value)) {
    throw new ApiError(422, "MCP_TOOL_ARGUMENTS_INVALID", "مدخلات الأداة لا تطابق مخطط MCP المعلن.", {
      validation: safeErrorSummary(validate.errors),
    });
  }
}

export function validateMcpToolOutput(schema: Record<string, unknown> | null, schemaHash: string, value: unknown) {
  assertMcpJsonLimits(value);
  if (!schema) return;
  const validate = validator(schema, schemaHash, "output");
  if (!validate(value)) {
    throw new ApiError(502, "MCP_TOOL_OUTPUT_INVALID", "أعاد خادم MCP نتيجة لا تطابق مخطط الأداة.", {
      validation: safeErrorSummary(validate.errors),
    });
  }
}

export function safeMcpResultRecord(value: unknown) {
  const serialized = JSON.stringify(value) ?? "null";
  return {
    digest: createHash("sha256").update(serialized).digest("hex"),
    bytes: Buffer.byteLength(serialized, "utf8"),
    isError: Boolean(value && typeof value === "object" && "isError" in value && value.isError),
    contentTypes: value && typeof value === "object" && "content" in value && Array.isArray(value.content)
      ? [...new Set(value.content.slice(0, 20).map((item) => item && typeof item === "object" && "type" in item ? String(item.type) : "unknown"))]
      : [],
  };
}
