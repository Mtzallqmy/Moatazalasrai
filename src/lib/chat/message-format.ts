export type MessageBlock =
  | { type: "code"; language: string | null; content: string }
  | { type: "paragraph"; content: string }
  | { type: "list"; ordered: boolean; items: string[] };

const fence = /^```([A-Za-z0-9_+.#-]{0,30})\s*$/;
const unordered = /^\s*[-*+]\s+(.+)$/;
const ordered = /^\s*\d+[.)]\s+(.+)$/;

export function parseMessageBlocks(source: string): MessageBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MessageBlock[] = [];
  let paragraph: string[] = [];
  let code: string[] | null = null;
  let language: string | null = null;
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    const content = paragraph.join("\n").trim();
    if (content) blocks.push({ type: "paragraph", content });
    paragraph = [];
  };
  const flushList = () => {
    if (list?.items.length) blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };

  for (const line of lines) {
    const fenceMatch = line.match(fence);
    if (code) {
      if (fenceMatch) {
        blocks.push({ type: "code", language, content: code.join("\n") });
        code = null;
        language = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (fenceMatch) {
      flushParagraph();
      flushList();
      code = [];
      language = fenceMatch[1] || null;
      continue;
    }
    const unorderedMatch = line.match(unordered);
    const orderedMatch = line.match(ordered);
    if (unorderedMatch || orderedMatch) {
      flushParagraph();
      const isOrdered = Boolean(orderedMatch);
      if (!list || list.ordered !== isOrdered) flushList();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push((unorderedMatch?.[1] ?? orderedMatch?.[1] ?? "").trim());
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  if (code) blocks.push({ type: "code", language, content: code.join("\n") });
  flushParagraph();
  flushList();
  return blocks;
}

export type InlinePart =
  | { type: "text"; content: string }
  | { type: "code"; content: string }
  | { type: "link"; content: string; href: string };

const inlinePattern = /(`[^`\n]+`|\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\))/g;

export function parseInlineParts(source: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let cursor = 0;
  for (const match of source.matchAll(inlinePattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ type: "text", content: source.slice(cursor, index) });
    const token = match[0];
    if (token.startsWith("`")) {
      parts.push({ type: "code", content: token.slice(1, -1) });
    } else {
      const labelEnd = token.indexOf("](");
      const label = token.slice(1, labelEnd);
      const href = token.slice(labelEnd + 2, -1);
      parts.push({ type: "link", content: label, href });
    }
    cursor = index + token.length;
  }
  if (cursor < source.length) parts.push({ type: "text", content: source.slice(cursor) });
  return parts.length ? parts : [{ type: "text", content: source }];
}
