export function retryDelayMs(attempt: number, baseMs = 1000, capMs = 60_000) {
  const exponential = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return exponential + Math.floor(Math.random() * Math.max(1, exponential * 0.2));
}
