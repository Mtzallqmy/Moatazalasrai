import { ApiError } from "@/lib/http/api";
import type { ProviderContentPart } from "@/lib/providers/types";
import { readMcpResource, renderMcpPrompt } from "./service";

export type McpResourceSelection = { serverId: string; uri: string };
export type McpPromptSelection = {
  serverId: string;
  name: string;
  arguments?: Record<string, string>;
};

const MAX_CONTEXT_CHARS = 250_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function decodedBase64Bytes(value: string) {
  return Math.floor(value.length * 0.75);
}

export async function buildMcpChatContext(input: {
  organizationId: string;
  userId?: string | null;
  resources?: McpResourceSelection[];
  prompt?: McpPromptSelection;
  signal?: AbortSignal;
}) {
  const textParts: string[] = [];
  const media: ProviderContentPart[] = [];
  const references: Array<Record<string, unknown>> = [];
  let textChars = 0;
  let imageBytes = 0;

  function addText(label: string, text: string) {
    const section = `\n\n[${label}]\n${text}`;
    textChars += section.length;
    if (textChars > MAX_CONTEXT_CHARS) {
      throw new ApiError(413, "MCP_CONTEXT_TOO_LARGE", "النص المختار من موارد MCP أكبر من ميزانية سياق الدردشة.", {
        maxCharacters: MAX_CONTEXT_CHARS,
      });
    }
    textParts.push(section);
  }

  function addImage(mimeType: string, data: string, source: string) {
    if (!IMAGE_MIME_TYPES.has(mimeType)) {
      addText("محتوى MCP ثنائي", `${source} (${mimeType}) متاح عبر API لكنه غير مدعوم كمدخل مباشر لهذا النموذج.`);
      return;
    }
    imageBytes += decodedBase64Bytes(data);
    if (imageBytes > MAX_IMAGE_BYTES) {
      throw new ApiError(413, "MCP_MEDIA_CONTEXT_TOO_LARGE", "إجمالي صور MCP المختارة يتجاوز 20 ميجابايت.");
    }
    media.push({
      type: "image",
      mediaType: mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
      data,
    });
  }

  function consumeResourceContent(value: unknown, fallbackLabel: string) {
    const content = objectValue(value);
    if (!content) return;
    const uri = typeof content.uri === "string" ? content.uri : fallbackLabel;
    const mimeType = typeof content.mimeType === "string" ? content.mimeType : "application/octet-stream";
    if (typeof content.text === "string") {
      addText(`مورد MCP: ${uri} · ${mimeType}`, content.text);
    } else if (typeof content.blob === "string") {
      addImage(mimeType, content.blob, uri);
    }
  }

  function consumeBlock(value: unknown, label: string) {
    const block = objectValue(value);
    if (!block) return;
    if (block.type === "text" && typeof block.text === "string") {
      addText(label, block.text);
      return;
    }
    if (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
      addImage(block.mimeType, block.data, label);
      return;
    }
    if (block.type === "resource") {
      consumeResourceContent(block.resource, label);
      return;
    }
    if (block.type === "resource_link" && typeof block.uri === "string") {
      addText(label, `مرجع مورد متاح للقراءة: ${block.uri}`);
      return;
    }
    if (block.type === "audio") {
      addText(label, "يتضمن القالب محتوى صوتيًا متاحًا عبر API، ولا يُمرر مباشرة إلى مزود النص الحالي.");
    }
  }

  for (const selection of input.resources ?? []) {
    const result = await readMcpResource({
      organizationId: input.organizationId,
      serverId: selection.serverId,
      uri: selection.uri,
      userId: input.userId,
      signal: input.signal,
    });
    const payload = objectValue(result);
    const contents = Array.isArray(payload?.contents) ? payload.contents : [];
    for (const content of contents) consumeResourceContent(content, selection.uri);
    references.push({ kind: "resource", serverId: selection.serverId, uri: selection.uri });
  }

  if (input.prompt) {
    const result = await renderMcpPrompt({
      organizationId: input.organizationId,
      serverId: input.prompt.serverId,
      name: input.prompt.name,
      arguments: input.prompt.arguments,
      userId: input.userId,
      signal: input.signal,
    });
    const payload = objectValue(result);
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    for (const messageValue of messages) {
      const message = objectValue(messageValue);
      if (!message) continue;
      const role = typeof message.role === "string" ? message.role : "user";
      consumeBlock(message.content, `قالب MCP: ${input.prompt.name} · ${role}`);
    }
    references.push({
      kind: "prompt",
      serverId: input.prompt.serverId,
      name: input.prompt.name,
      arguments: input.prompt.arguments ?? {},
    });
  }

  return { text: textParts.join(""), media, references };
}
