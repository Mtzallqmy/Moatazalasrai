import { generateWithProvider } from "@/lib/providers/registry";
import type { ProviderKind, ProviderMessage } from "@/lib/providers/types";

export type GenerateRequest = {
  provider: ProviderKind;
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ProviderMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  requestId?: string;
};

export async function generateText(request: GenerateRequest) {
  return generateWithProvider(request.provider, {
    apiKey: request.apiKey,
    baseUrl: request.baseUrl,
    model: request.model,
    messages: request.messages,
    temperature: request.temperature ?? 0.2,
    maxOutputTokens: request.maxOutputTokens ?? 2048,
    signal: request.signal,
    requestId: request.requestId ?? crypto.randomUUID(),
  });
}
