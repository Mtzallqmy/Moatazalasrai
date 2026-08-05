export type { AgentToolBinding, ToolRuntimeState } from "@/lib/ai-sdk/mcp-tool-loader";
import type { ToolRuntimeState } from "@/lib/ai-sdk/mcp-tool-loader";
import { loadUnifiedAgentTools } from "@/lib/ai-sdk/unified-tool-registry";

/**
 * Compatibility entrypoint used by the existing AI runtime. All MCP and
 * platform-native tools now pass through one tenant-scoped registry.
 */
export function loadAgentMcpTools(input: {
  organizationId: string;
  agentId: string;
  runId: string;
  userId?: string | null;
  allowedToolIds?: readonly string[] | null;
  state: ToolRuntimeState;
}) {
  return loadUnifiedAgentTools(input);
}
