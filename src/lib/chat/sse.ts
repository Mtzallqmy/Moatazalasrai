export type ParsedServerEvent = {
  event: string;
  data: string;
};

/**
 * Splits an SSE stream without losing an event when the server closes the
 * response immediately after its final data line (without a trailing blank
 * line). The caller keeps `remainder` between network chunks.
 */
export function splitServerEvents(buffer: string, flush = false): {
  events: ParsedServerEvent[];
  remainder: string;
} {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const remainder = flush ? "" : blocks.pop() ?? "";

  if (flush) {
    const tail = blocks.pop();
    if (tail?.trim()) blocks.push(tail);
  }

  const events = blocks.flatMap((block) => {
    if (!block.trim()) return [];
    const lines = block.split("\n");
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    return data ? [{ event, data }] : [];
  });

  return { events, remainder };
}
