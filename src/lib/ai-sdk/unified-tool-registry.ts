import { and, eq } from "drizzle-orm";
import type { ToolSet } from "ai";
import { db } from "@/db";
import { organizationMembers } from "@/db/schema";
import { agentToolBindings } from "@/db/tool-registry-schema";
import { loadAgentMcpTools, type ToolRuntimeState } from "@/lib/ai-sdk/mcp-tools";
import { createSandboxTools } from "@/lib/ai-sdk/sandbox-tools";

function selectedInternalTools(tools: ToolSet, bindings: Set<string>) {
  const selected: ToolSet = {};
  for (const [name, value] of Object.entries(tools)) {
    const namespace = `${name.split(".")[0]}.*`;
    if (bindings.has(name) || bindings.has(namespace)) selected[name] = value;
  }
  return selected;
}

export async function loadUnifiedAgentTools(input: {
  organizationId: string;
  userId?: string | null;
  agentId: string;
  runId: string;
  conversationId: string;
  requestId: string;
  allowedToolIds?: readonly string[] | null;
  state: ToolRuntimeState;
}) {
  const mcp = await loadAgentMcpTools({
    organizationId: input.organizationId,
    userId: input.userId,
    agentId: input.agentId,
    runId: input.runId,
    allowedToolIds: input.allowedToolIds,
    state: input.state,
  });

  const internalTools: ToolSet = {};
  if (input.userId) {
    const [[membership], rows] = await Promise.all([
      db().select({ role: organizationMembers.role }).from(organizationMembers).where(and(
        eq(organizationMembers.organizationId, input.organizationId),
        eq(organizationMembers.userId, input.userId),
      )).limit(1),
      db().select({ toolName: agentToolBindings.toolName }).from(agentToolBindings).where(and(
        eq(agentToolBindings.organizationId, input.organizationId),
        eq(agentToolBindings.agentId, input.agentId),
        eq(agentToolBindings.enabled, true),
      )),
    ]);
    if (membership) {
      const names = new Set(rows.map((row) => row.toolName));
      Object.assign(internalTools, selectedInternalTools(createSandboxTools({
        organizationId: input.organizationId,
        userId: input.userId,
        role: membership.role,
        conversationId: input.conversationId,
        agentId: input.agentId,
        runId: input.runId,
        requestId: input.requestId,
      }), names));
    }
  }

  const tools: ToolSet = { ...mcp.tools, ...internalTools };
  return {
    tools,
    bindings: mcp.bindings,
    hasTools: Object.keys(tools).length > 0,
    internalToolNames: Object.keys(internalTools),
  };
}
