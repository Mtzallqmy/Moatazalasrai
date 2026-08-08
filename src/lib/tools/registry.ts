import { TOOL_MANIFESTS } from "./manifest";
import type { ToolId, ToolManifest } from "./contracts";

const byId = new Map<ToolId, ToolManifest>(TOOL_MANIFESTS.map((manifest) => [manifest.id, manifest]));

export function listToolManifests(): readonly ToolManifest[] { return TOOL_MANIFESTS; }
export function getToolManifest(toolId: string): ToolManifest | null { return byId.get(toolId as ToolId) ?? null; }
export function requireToolManifest(toolId: string): ToolManifest {
  const manifest = getToolManifest(toolId);
  if (!manifest) throw new Error("TOOL_NOT_FOUND");
  return manifest;
}
