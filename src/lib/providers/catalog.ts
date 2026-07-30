import type { ProviderKind } from "@/lib/providers/types";

export type ProviderApiStyle =
  | "native_openai"
  | "native_anthropic"
  | "native_gemini"
  | "openai_chat"
  | "openai_responses";

export type ProviderPreset = {
  slug: string;
  label: string;
  labelAr: string;
  descriptionAr: string;
  provider: ProviderKind;
  apiStyle: ProviderApiStyle;
  defaultBaseUrl: string;
  category: "first_party" | "cloud" | "router" | "inference" | "custom";
  baseUrlEditable: boolean;
  manualModelAllowed: boolean;
};

export const providerPresets = [
  {
    slug: "openai",
    label: "OpenAI",
    labelAr: "OpenAI",
    descriptionAr: "واجهة OpenAI الأصلية عبر Responses API مع اكتشاف النماذج.",
    provider: "openai",
    apiStyle: "native_openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    category: "first_party",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "anthropic",
    label: "Anthropic",
    labelAr: "Anthropic Claude",
    descriptionAr: "واجهة Anthropic Messages الأصلية ومفاتيح x-api-key.",
    provider: "anthropic",
    apiStyle: "native_anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    category: "first_party",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "google-gemini",
    label: "Google Gemini",
    labelAr: "Google Gemini",
    descriptionAr: "واجهة Gemini الأصلية مع generateContent وstreamGenerateContent.",
    provider: "gemini",
    apiStyle: "native_gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    category: "first_party",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "google-gemini-openai",
    label: "Gemini OpenAI compatibility",
    labelAr: "Gemini المتوافق مع OpenAI",
    descriptionAr: "طبقة Google الرسمية المتوافقة مع OpenAI SDK.",
    provider: "openai_compatible",
    apiStyle: "openai_chat",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    category: "first_party",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "openrouter",
    label: "OpenRouter",
    labelAr: "OpenRouter",
    descriptionAr: "موجّه نماذج متعدد المزودين بواجهة OpenAI-compatible.",
    provider: "openai_compatible",
    apiStyle: "openai_chat",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    category: "router",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "huggingface",
    label: "Hugging Face Inference Providers",
    labelAr: "Hugging Face Inference Providers",
    descriptionAr: "موجّه Hugging Face للنماذج الحوارية ومزودي الاستدلال.",
    provider: "openai_compatible",
    apiStyle: "openai_chat",
    defaultBaseUrl: "https://router.huggingface.co/v1",
    category: "router",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "groq",
    label: "GroqCloud",
    labelAr: "GroqCloud",
    descriptionAr: "استدلال سريع متوافق مع OpenAI مع بث وقائمة نماذج.",
    provider: "openai_compatible",
    apiStyle: "openai_chat",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    category: "inference",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "together",
    label: "Together AI",
    labelAr: "Together AI",
    descriptionAr: "نماذج مفتوحة وواجهات Chat/Vision متوافقة مع OpenAI.",
    provider: "openai_compatible",
    apiStyle: "openai_chat",
    defaultBaseUrl: "https://api.together.xyz/v1",
    category: "inference",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "nvidia-nim",
    label: "NVIDIA NIM / API Catalog",
    labelAr: "NVIDIA NIM",
    descriptionAr: "واجهات NVIDIA NIM المتوافقة مع OpenAI؛ يمكن تغيير العنوان لنشر NIM خاص.",
    provider: "openai_compatible",
    apiStyle: "openai_chat",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    category: "inference",
    baseUrlEditable: true,
    manualModelAllowed: true,
  },
  {
    slug: "aws-bedrock-mantle",
    label: "Amazon Bedrock Mantle",
    labelAr: "Amazon Bedrock — OpenAI compatibility",
    descriptionAr: "واجهة Bedrock Mantle المتوافقة مع OpenAI Responses API باستخدام Bedrock API key.",
    provider: "openai_compatible",
    apiStyle: "openai_responses",
    defaultBaseUrl: "https://bedrock-mantle.us-east-1.api.aws/v1",
    category: "cloud",
    baseUrlEditable: true,
    manualModelAllowed: true,
  },
  {
    slug: "fireworks",
    label: "Fireworks AI",
    labelAr: "Fireworks AI",
    descriptionAr: "نماذج Serverless وOn-demand عبر OpenAI-compatible API.",
    provider: "openai_compatible",
    apiStyle: "openai_chat",
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    category: "inference",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "deepinfra",
    label: "DeepInfra",
    labelAr: "DeepInfra",
    descriptionAr: "واجهة DeepInfra المتوافقة مع OpenAI للنص والرؤية.",
    provider: "openai_compatible",
    apiStyle: "openai_chat",
    defaultBaseUrl: "https://api.deepinfra.com/v1/openai",
    category: "inference",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "mistral",
    label: "Mistral AI",
    labelAr: "Mistral AI",
    descriptionAr: "واجهة Mistral الرسمية المتوافقة مع OpenAI Chat Completions.",
    provider: "openai_compatible",
    apiStyle: "openai_chat",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    category: "first_party",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "deepseek",
    label: "DeepSeek",
    labelAr: "DeepSeek",
    descriptionAr: "واجهة DeepSeek المتوافقة مع OpenAI.",
    provider: "openai_compatible",
    apiStyle: "openai_chat",
    defaultBaseUrl: "https://api.deepseek.com",
    category: "first_party",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "xai",
    label: "xAI",
    labelAr: "xAI Grok",
    descriptionAr: "واجهة xAI Responses API المتوافقة مع OpenAI.",
    provider: "openai_compatible",
    apiStyle: "openai_responses",
    defaultBaseUrl: "https://api.x.ai/v1",
    category: "first_party",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "perplexity-sonar",
    label: "Perplexity Sonar",
    labelAr: "Perplexity Sonar",
    descriptionAr: "واجهة Sonar المتوافقة مع OpenAI Chat Completions.",
    provider: "openai_compatible",
    apiStyle: "openai_chat",
    defaultBaseUrl: "https://api.perplexity.ai",
    category: "first_party",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "perplexity-agent",
    label: "Perplexity Agent API",
    labelAr: "Perplexity Agent API",
    descriptionAr: "واجهة Perplexity Agent المتوافقة مع OpenAI Responses API.",
    provider: "openai_compatible",
    apiStyle: "openai_responses",
    defaultBaseUrl: "https://api.perplexity.ai/v1",
    category: "first_party",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "cerebras",
    label: "Cerebras Inference",
    labelAr: "Cerebras Inference",
    descriptionAr: "استدلال Cerebras المتوافق مع OpenAI.",
    provider: "openai_compatible",
    apiStyle: "openai_chat",
    defaultBaseUrl: "https://api.cerebras.ai/v1",
    category: "inference",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "sambanova",
    label: "SambaNova Cloud",
    labelAr: "SambaNova Cloud",
    descriptionAr: "واجهة SambaCloud المتوافقة مع OpenAI.",
    provider: "openai_compatible",
    apiStyle: "openai_chat",
    defaultBaseUrl: "https://api.sambanova.ai/v1",
    category: "inference",
    baseUrlEditable: true,
    manualModelAllowed: true,
  },
  {
    slug: "agentrouter",
    label: "AgentRouter",
    labelAr: "AgentRouter",
    descriptionAr: "موجّه AgentRouter عبر عنوانه الرسمي.",
    provider: "openai_compatible",
    apiStyle: "openai_chat",
    defaultBaseUrl: "https://co.agentrouter.org/v1",
    category: "router",
    baseUrlEditable: false,
    manualModelAllowed: true,
  },
  {
    slug: "custom-openai-compatible",
    label: "Custom OpenAI-compatible",
    labelAr: "مزود مخصص متوافق مع OpenAI",
    descriptionAr: "أي خدمة موثوقة توفر /models و/chat/completions أو نموذجًا يدويًا.",
    provider: "openai_compatible",
    apiStyle: "openai_chat",
    defaultBaseUrl: "",
    category: "custom",
    baseUrlEditable: true,
    manualModelAllowed: true,
  },
] as const satisfies readonly ProviderPreset[];

const presetMap = new Map<string, ProviderPreset>(providerPresets.map((preset) => [preset.slug, preset]));

export function getProviderPreset(slug?: string | null) {
  if (!slug) return undefined;
  return presetMap.get(slug);
}

export function defaultProviderSlug(provider: ProviderKind) {
  if (provider === "openai") return "openai";
  if (provider === "anthropic") return "anthropic";
  if (provider === "gemini") return "google-gemini";
  return "custom-openai-compatible";
}

export function resolveProviderPreset(input: { provider: ProviderKind; providerSlug?: string | null }) {
  const preset = getProviderPreset(input.providerSlug ?? defaultProviderSlug(input.provider));
  if (!preset || preset.provider !== input.provider) return getProviderPreset(defaultProviderSlug(input.provider))!;
  return preset;
}

export function publicProviderCatalog() {
  return providerPresets.map((preset) => ({ ...preset }));
}
