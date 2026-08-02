"use client";

import { getPuterClient } from "@/lib/puter/client";
import type { ClientAIModel, PuterClient } from "@/lib/puter/types";

const CACHE_KEY = "moataz:puter:models:v1";
const CACHE_TTL_MS = 15 * 60_000;
let memoryCache: { expiresAt: number; models: ClientAIModel[] } | null = null;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function finiteNumber(...values: unknown[]): number | null {
  for (const value of values) if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return null;
}

function normalizeCapabilities(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  const data = record(value);
  if (!data) return [];
  return Object.entries(data).filter(([, enabled]) => enabled === true).map(([key]) => key);
}

function isChatModel(model: UnknownRecord): boolean {
  const capabilities = record(model.capabilities);
  if (!capabilities) return true;
  if (capabilities.chat === false || capabilities.text === false) return false;
  return true;
}

export function normalizePuterModels(value: unknown): ClientAIModel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const models: ClientAIModel[] = [];
  for (const item of value) {
    const model = record(item);
    const id = typeof model?.id === "string" ? model.id.trim() : "";
    if (!id || seen.has(id) || !model || !isChatModel(model)) continue;
    seen.add(id);
    const cost = record(model.cost);
    models.push({
      id,
      name: typeof model.name === "string" && model.name.trim() ? model.name.trim() : id,
      provider: typeof model.provider === "string" && model.provider.trim() ? model.provider.trim() : "puter",
      contextWindow: finiteNumber(model.context, model.context_window, model.contextWindow),
      maxOutputTokens: finiteNumber(model.max_tokens, model.max_output_tokens, model.maxOutputTokens),
      capabilities: normalizeCapabilities(model.capabilities),
      cost: cost ? Object.fromEntries(Object.entries(cost).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))) : null,
    });
  }
  return models.sort((left, right) => left.name.localeCompare(right.name));
}

function readSessionCache(now: number): ClientAIModel[] | null {
  if (memoryCache && memoryCache.expiresAt > now) return memoryCache.models;
  if (typeof sessionStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "null") as { expiresAt?: unknown; models?: unknown } | null;
    if (!parsed || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= now) return null;
    const models = normalizePuterModels(parsed.models);
    memoryCache = { expiresAt: parsed.expiresAt, models };
    return models;
  } catch {
    return null;
  }
}

function writeSessionCache(models: ClientAIModel[], now: number) {
  const value = { expiresAt: now + CACHE_TTL_MS, models };
  memoryCache = value;
  if (typeof sessionStorage !== "undefined") {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch { /* cache is optional */ }
  }
}

export async function listPuterModels(input: { force?: boolean; client?: PuterClient } = {}): Promise<ClientAIModel[]> {
  const now = Date.now();
  if (!input.force) {
    const cached = readSessionCache(now);
    if (cached) return cached;
  }
  const client = input.client ?? await getPuterClient();
  try {
    const models = normalizePuterModels(await client.ai.listModels());
    if (!models.length) throw new Error("empty");
    writeSessionCache(models, now);
    return models;
  } catch {
    throw new Error("تعذر تحميل نماذج Puter. حاول إعادة التحميل.");
  }
}

export function clearPuterModelCache() {
  memoryCache = null;
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(CACHE_KEY);
}
