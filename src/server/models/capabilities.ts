import type { ProviderKind } from "@/lib/providers/types";

export type ModelCapabilities = {
  text: boolean;
  vision: boolean;
  files: boolean;
  tools: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  structuredOutputs: boolean;
  streaming: boolean;
  audio: boolean;
  video: boolean;
  coding: boolean;
};

const NON_GENERATIVE = /(embedding|embed|moderation|rerank|whisper|tts|speech|image-gen|dall-e)/i;
const VISION_MODELS = /(vision|(?:^|[-/_.])vl(?:[-/_.]|$)|llava|pixtral|gemma-3|phi-4-multimodal|mistral-small-3\.1|gpt-(?:4o|4\.1|4\.5|5)|o[134](?:[-/_.]|$)|claude-(?:3|sonnet|opus|haiku)|gemini)/i;
const CODING_MODELS = /(code|coder|codex|deepseek|qwen|gpt|claude|gemini|mistral|llama)/i;
const TOOL_MODELS = /(gpt|claude|gemini|mistral|llama|qwen|deepseek|command-r|grok|sonar)/i;
const AUDIO_MODELS = /(audio|realtime|gemini.*live|multimodal)/i;
const VIDEO_MODELS = /(video|gemini|multimodal)/i;

export function inferModelCapabilities(provider: ProviderKind, model: string): ModelCapabilities {
  const normalized = model.trim().toLowerCase();
  const text = !NON_GENERATIVE.test(normalized);
  const providerVision = provider === "gemini" || provider === "anthropic";
  const toolCalling = text && TOOL_MODELS.test(normalized);
  const structuredOutputs = text && TOOL_MODELS.test(normalized);
  return {
    text,
    vision: text && (providerVision || VISION_MODELS.test(normalized)),
    files: text,
    tools: toolCalling,
    toolCalling,
    structuredOutput: structuredOutputs,
    structuredOutputs,
    streaming: text,
    audio: text && AUDIO_MODELS.test(normalized),
    video: text && VIDEO_MODELS.test(normalized),
    coding: text && CODING_MODELS.test(normalized),
  };
}

export function isFreeTierModel(model: string) {
  return /(?:^|:)free$/i.test(model.trim());
}
