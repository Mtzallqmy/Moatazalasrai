import { and, eq } from "drizzle-orm";
import type { ToolSet } from "ai";
import { db } from "@/db";
import { organizationMembers, runs } from "@/db/schema";
import { agentToolBindings } from "@/db/tool-registry-schema";
import { loadBoundMcpTools, type ToolRuntimeState } from "@/lib/ai-sdk/mcp-tool-loader";
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
  allowedToolIds?: readonly string[] | null;
  state: ToolRuntimeState;
}) {
  const mcp = await loadBoundMcpTools(input);
  const internalTools: ToolSet = {};

  if (input.userId) {
    const [[membership], [run], rows] = await Promise.all([
      db().select({ role: organizationMembers.role }).from(organizationMembers).where(and(
        eq(organizationMembers.organizationId, input.organizationId),
        eq(organizationMembers.userId, input.userId),
      )).limit(1),
      db().select({ conversationId: runs.conversationId }).from(runs).where(and(
        eq(runs.id, input.runId),
        eq(runs.organizationId, input.organizationId),
        eq(runs.agentId, input.agentId),
      )).limit(1),
      db().select({ toolName: agentToolBindings.toolName }).from(agentToolBindings).where(and(
        eq(agentToolBindings.organizationId, input.organizationId),
        eq(agentToolBindings.agentId, input.agentId),
        eq(agentToolBindings.enabled, true),
      )),
    ]);
    if (membership && run?.conversationId) {
      const names = new Set(rows.map((row) => row.toolName));
      Object.assign(internalTools, selectedInternalTools(createSandboxTools({
        organizationId: input.organizationId,
        userId: input.userId,
        role: membership.role,
        conversationId: run.conversationId,
        agentId: input.agentId,
        runId: input.runId,
        requestId: `agent-run:${input.runId}`,
        state: input.state,
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
