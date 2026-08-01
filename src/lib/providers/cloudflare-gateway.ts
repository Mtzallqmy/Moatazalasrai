import { llmGateway } from "@/lib/providers/llm-gateway";

export {
  LLMGateway,
  cloudflareAiGatewayStatus,
  llmGateway,
} from "@/lib/providers/llm-gateway";

/**
 * Compatibility export for existing internal imports.
 * New code should use the centralized llmGateway instance.
 */
export function resolveCloudflareGateway(input: Parameters<typeof llmGateway.resolve>[0]) {
  return llmGateway.resolve(input);
}
