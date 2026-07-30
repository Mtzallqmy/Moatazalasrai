type ToolDescriptor = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

export type McpToolClassification = {
  capability: "image_generation" | "video_generation" | "media_processing" | "general";
  mediaType: "image" | "video" | null;
};

const VIDEO_TERMS = [
  "video", "motion", "animate", "animation", "cinema", "clip", "scene", "lipsync",
  "lip_sync", "talking avatar", "camera movement", "frame interpolation",
];
const IMAGE_TERMS = [
  "image", "photo", "picture", "portrait", "illustration", "visual", "canvas",
  "inpaint", "outpaint", "upscale", "background", "style transfer",
];
const GENERATION_TERMS = [
  "generate", "create", "render", "produce", "text-to", "text_to", "image-to", "image_to",
];

function includesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

export function classifyMcpTool(tool: ToolDescriptor): McpToolClassification {
  const searchable = JSON.stringify({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  }).toLowerCase();

  const isVideo = includesAny(searchable, VIDEO_TERMS);
  const isImage = includesAny(searchable, IMAGE_TERMS);
  const isGeneration = includesAny(searchable, GENERATION_TERMS);

  if (isVideo && isGeneration) return { capability: "video_generation", mediaType: "video" };
  if (isImage && isGeneration) return { capability: "image_generation", mediaType: "image" };
  if (isVideo) return { capability: "media_processing", mediaType: "video" };
  if (isImage) return { capability: "media_processing", mediaType: "image" };
  return { capability: "general", mediaType: null };
}
