export type TextChunk = { index: number; text: string; start: number; end: number };
export function chunkText(input: string, options: { size?: number; overlap?: number } = {}): TextChunk[] {
  const size = options.size ?? 1200, overlap = options.overlap ?? 150;
  if (size < 200 || overlap < 0 || overlap >= size) throw new Error("INVALID_CHUNK_OPTIONS");
  const normalized = input.replace(/\r\n/g, "\n").trim();
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < normalized.length) {
    const hardEnd = Math.min(start + size, normalized.length);
    const candidates = [normalized.lastIndexOf("\n\n", hardEnd), normalized.lastIndexOf(". ", hardEnd), normalized.lastIndexOf("؟ ", hardEnd)];
    const boundary = Math.max(...candidates);
    const end = hardEnd < normalized.length && boundary > start + size * 0.6 ? boundary + 1 : hardEnd;
    const text = normalized.slice(start, end).trim();
    if (text) chunks.push({ index: chunks.length, text, start, end });
    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
