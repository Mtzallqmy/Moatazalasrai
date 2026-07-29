export type InputKind = "text" | "image" | "file" | "coding" | "summary" | "analysis" | "audio" | "video";
export type RoutableModel = {
  providerCredentialId: string;
  model: string;
  available: boolean;
  freeTierEligible: boolean;
  latencyMs: number | null;
  capabilities: Record<string, boolean | undefined>;
  isOrganizationDefault?: boolean;
  isAgentDefault?: boolean;
};

const requiredCapability: Record<InputKind, string> = {
  text: "text",
  image: "vision",
  file: "files",
  coding: "coding",
  summary: "text",
  analysis: "text",
  audio: "audio",
  video: "vision",
};

export function scoreModel(model: RoutableModel, inputKind: InputKind) {
  if (!model.available || model.capabilities[requiredCapability[inputKind]] !== true) return Number.NEGATIVE_INFINITY;
  let score = 0;
  if (model.capabilities[requiredCapability[inputKind]] === true) score += 100;
  if (model.freeTierEligible) score += 35;
  if (model.isAgentDefault) score += 25;
  if (model.isOrganizationDefault) score += 15;
  if (model.latencyMs !== null) score += Math.max(0, 20 - model.latencyMs / 250);
  return score;
}

export function rankModels(models: RoutableModel[], inputKind: InputKind) {
  return models.map((model) => ({ model, score: scoreModel(model, inputKind) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.model);
}

export function selectBestModel(models: RoutableModel[], inputKind: InputKind) {
  return rankModels(models, inputKind)[0] ?? null;
}
