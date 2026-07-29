const patterns = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g,
  /\b(?:password|api[_ -]?key|token|secret)\s*[:=]\s*\S+/gi,
];
export function redactMemoryInput(value: string) {
  return patterns.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value).trim();
}
export function isUnsafeToMemorize(value: string) {
  const result = redactMemoryInput(value);
  return !result || result.includes("[REDACTED]");
}
