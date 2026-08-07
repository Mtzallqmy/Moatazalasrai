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
  starterModel?: string;
};

type PresetOptions = Pick<ProviderPreset, "category" | "baseUrlEditable"> & { starterModel?: string };

function preset(
  slug: string,
  label: string,
  labelAr: string,
  descriptionAr: string,
  provider: ProviderKind,
  apiStyle: ProviderApiStyle,
  defaultBaseUrl: string,
  options: PresetOptions,
): ProviderPreset {
  return { slug, label, labelAr, descriptionAr, provider, apiStyle, defaultBaseUrl, ...options, manualModelAllowed: true };
}

const fixed = (category: ProviderPreset["category"], starterModel?: string): PresetOptions => ({ category, baseUrlEditable: false, starterModel });
const editable = (category: ProviderPreset["category"], starterModel?: string): PresetOptions => ({ category, baseUrlEditable: true, starterModel });

export const providerPresets: readonly ProviderPreset[] = [
  preset("openai", "OpenAI", "OpenAI", "واجهة OpenAI الأصلية عبر Responses API مع اكتشاف النماذج.", "openai", "native_openai", "https://api.openai.com/v1", fixed("first_party")),
  preset("anthropic", "Anthropic", "Anthropic Claude", "واجهة Anthropic Messages الأصلية ومفاتيح x-api-key.", "anthropic", "native_anthropic", "https://api.anthropic.com", fixed("first_party")),
  preset("google-gemini", "Google Gemini", "Google Gemini", "واجهة Gemini الأصلية مع generateContent والبث.", "gemini", "native_gemini", "https://generativelanguage.googleapis.com/v1beta", fixed("first_party")),
  preset("google-gemini-openai", "Gemini OpenAI compatibility", "Gemini المتوافق مع OpenAI", "طبقة Google الرسمية المتوافقة مع OpenAI SDK.", "openai_compatible", "openai_chat", "https://generativelanguage.googleapis.com/v1beta/openai", fixed("first_party")),
  preset("openrouter", "OpenRouter", "OpenRouter", "موجّه نماذج متعدد المزودين بواجهة OpenAI-compatible.", "openai_compatible", "openai_chat", "https://openrouter.ai/api/v1", fixed("router")),
  preset("opencode-zen", "OpenCode Zen", "OpenCode Zen", "بوابة OpenCode Zen عبر Chat Completions للنماذج التي توثقها OpenCode كـ OpenAI-compatible. يبدأ الفحص بنموذج DeepSeek V4 Flash Free ويمكن تغييره إلى أي نموذج Chat مدعوم.", "openai_compatible", "openai_chat", "https://opencode.ai/zen/v1", fixed("router", "deepseek-v4-flash-free")),
  preset("huggingface", "Hugging Face Inference Providers", "Hugging Face Inference Providers", "موجّه Hugging Face للنماذج الحوارية ومزودي الاستدلال.", "openai_compatible", "openai_chat", "https://router.huggingface.co/v1", fixed("router")),
  preset("groq", "GroqCloud", "GroqCloud", "استدلال سريع متوافق مع OpenAI مع بث وقائمة نماذج.", "openai_compatible", "openai_chat", "https://api.groq.com/openai/v1", fixed("inference")),
  preset("together", "Together AI", "Together AI", "نماذج مفتوحة وواجهات Chat/Vision متوافقة مع OpenAI.", "openai_compatible", "openai_chat", "https://api.together.ai/v1", fixed("inference")),
  preset("inferx", "InferX", "InferX", "منصة InferX للاستدلال Serverless عبر واجهة OpenAI-compatible. يستخدم الاتصال المشترك /endpoints/v1 ولا يُحفظ إلا بعد اختبار توليد حقيقي.", "openai_compatible", "openai_chat", "https://model.inferx.net/endpoints/v1", fixed("inference", "deepseek-v4-flash")),
  preset("nvidia-nim", "NVIDIA NIM / API Catalog", "NVIDIA NIM", "واجهات NVIDIA NIM المتوافقة مع OpenAI؛ يمكن تغيير العنوان لنشر NIM خاص.", "openai_compatible", "openai_chat", "https://integrate.api.nvidia.com/v1", editable("inference")),
  preset("aws-bedrock-mantle", "Amazon Bedrock Mantle", "Amazon Bedrock — OpenAI compatibility", "واجهة Bedrock Mantle المتوافقة مع OpenAI Responses API باستخدام Bedrock API key.", "openai_compatible", "openai_responses", "https://bedrock-mantle.us-east-1.api.aws/v1", editable("cloud")),
  preset("fireworks", "Fireworks AI", "Fireworks AI", "نماذج Serverless وOn-demand عبر OpenAI-compatible API.", "openai_compatible", "openai_chat", "https://api.fireworks.ai/inference/v1", fixed("inference")),
  preset("deepinfra", "DeepInfra", "DeepInfra", "واجهة DeepInfra المتوافقة مع OpenAI للنص والرؤية.", "openai_compatible", "openai_chat", "https://api.deepinfra.com/v1/openai", fixed("inference")),
  preset("mistral", "Mistral AI", "Mistral AI", "واجهة Mistral الرسمية المتوافقة مع OpenAI Chat Completions.", "openai_compatible", "openai_chat", "https://api.mistral.ai/v1", fixed("first_party")),
  preset("deepseek", "DeepSeek", "DeepSeek", "واجهة DeepSeek المتوافقة مع OpenAI.", "openai_compatible", "openai_chat", "https://api.deepseek.com", fixed("first_party")),
  preset("xai", "xAI", "xAI Grok", "واجهة xAI Responses API المتوافقة مع OpenAI.", "openai_compatible", "openai_responses", "https://api.x.ai/v1", fixed("first_party")),
  preset("perplexity-sonar", "Perplexity Sonar", "Perplexity Sonar", "واجهة Sonar المتوافقة مع OpenAI Chat Completions.", "openai_compatible", "openai_chat", "https://api.perplexity.ai", fixed("first_party")),
  preset("perplexity-agent", "Perplexity Agent API", "Perplexity Agent API", "واجهة Perplexity Agent المتوافقة مع OpenAI Responses API.", "openai_compatible", "openai_responses", "https://api.perplexity.ai/v1", fixed("first_party")),
  preset("cerebras", "Cerebras Inference", "Cerebras Inference", "استدلال Cerebras المتوافق مع OpenAI.", "openai_compatible", "openai_chat", "https://api.cerebras.ai/v1", fixed("inference")),
  preset("sambanova", "SambaNova Cloud", "SambaNova Cloud", "واجهة SambaCloud المتوافقة مع OpenAI.", "openai_compatible", "openai_chat", "https://api.sambanova.ai/v1", editable("inference")),
  preset("agentrouter", "AgentRouter", "AgentRouter", "موجّه AgentRouter عبر عنوانه الرسمي.", "openai_compatible", "openai_chat", "https://co.agentrouter.org/v1", fixed("router")),
  preset("custom-openai-compatible", "Custom OpenAI-compatible", "مزود مخصص متوافق مع OpenAI", "أي خدمة موثوقة توفر /models و/chat/completions أو نموذجًا يدويًا.", "openai_compatible", "openai_chat", "", editable("custom")),
];

const presetMap = new Map(providerPresets.map((item) => [item.slug, item]));

export function getProviderPreset(slug?: string | null) {
  return slug ? presetMap.get(slug) : undefined;
}

export function defaultProviderSlug(provider: ProviderKind) {
  if (provider === "openai") return "openai";
  if (provider === "anthropic") return "anthropic";
  if (provider === "gemini") return "google-gemini";
  return "custom-openai-compatible";
}

export function resolveProviderPreset(input: { provider: ProviderKind; providerSlug?: string | null }) {
  const selected = getProviderPreset(input.providerSlug ?? defaultProviderSlug(input.provider));
  return selected?.provider === input.provider ? selected : getProviderPreset(defaultProviderSlug(input.provider))!;
}

export function publicProviderCatalog() {
  return providerPresets.map((item) => ({ ...item }));
}
