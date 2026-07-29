import type { ProviderKind } from "@/lib/providers/types";

export type ModelCapabilities = {
  text: boolean;
  vision: boolean;
  files: boolean;
  tools: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  audio: boolean;
  coding: boolean;
};

const NON_GENERATIVE = /(embedding|embed|moderation|rerank|whisper|tts|speech|image-gen|dall-e)/i;
const VISION_MODELS = /(vision|(?:^|[-/_.])vl(?:[-/_.]|$)|llava|pixtral|gemma-3|phi-4-multimodal|mistral-small-3\.1|gpt-(?:4o|4\.1|4\.5|5)|o[134](?:[-/_.]|$)|claude-(?:3|sonnet|opus|haiku)|gemini)/i;
const CODING_MODELS = /(code|coder|codex|deepseek|qwen|gpt|claude|gemini|mistral|llama)/i;
const STRUCTURED_MODELS = /(gpt|claude|gemini|mistral|llama|qwen|deepseek)/i;

export function inferModelCapabilities(provider: ProviderKind, model: string): ModelCapabilities {
  const normalized = model.trim().toLowerCase();
  const text = !NON_GENERATIVE.test(normalized);
  const providerVision = provider === "gemini" || provider === "anthropic";
  return {
    text,
    vision: text && (providerVision || VISION_MODELS.test(normalized)),
    files: text,
    tools: text && STRUCTURED_MODELS.test(normalized),
    structuredOutput: text && STRUCTURED_MODELS.test(normalized),
    streaming: text,
    audio: false,
    coding: text && CODING_MODELS.test(normalized),
  };
}

export function isFreeTierModel(model: string) {
  return /(?:^|:)free$/i.test(model.trim());
}
