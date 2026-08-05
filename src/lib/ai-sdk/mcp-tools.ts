import { and, eq } from "drizzle-orm";
import { dynamicTool, jsonSchema, type ToolSet } from "ai";
import { db } from "@/db";
import { agentMcpTools, agents, mcpServers, mcpTools } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { evaluateToolApproval, type ApprovalMode } from "@/lib/ai-sdk/approval-policy";
import { executeMcpToolIdempotent } from "@/ai/mcp/execution";

export type AgentToolBinding = {
  safeName: string;
  toolId: string;
  serverId: string;
  originalName: string;
  title: string | null;
  description: string | null;
  approvalMode: ApprovalMode;
  risk: string;
  capability: string;
  annotations: Record<string, unknown>;
  maxCallsPerRun: number;
};

export type ToolRuntimeState = {
  toolExecuted: boolean;
  toolResultSaved: boolean;
  sideEffectOccurred: boolean;
  allocateStep: () => number;
};

function safeToolName(toolId: string) {
  return `mcp_${toolId.replaceAll("-", "")}`;
}

function objectArguments(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(422, "MCP_TOOL_ARGUMENTS_INVALID", "معاملات أداة MCP يجب أن تكون كائن JSON.");
  }
  return value as Record<string, unknown>;
}

function validInputSchema(value: Record<string, unknown>) {
  const type = value.type;
  if (type !== undefined && type !== "object") {
    throw new ApiError(422, "MCP_TOOL_SCHEMA_INVALID", "مخطط أداة MCP يجب أن يصف كائن JSON.");
  }
  return { type: "object" as const, additionalProperties: true, ...value };
}

function aiJsonSchema(value: Record<string, unknown>) {
  // AI SDK accepts JSON Schema 7. MCP schemas are validated above; the cast is limited to this external-library boundary.
  return jsonSchema<Record<string, unknown>>(value as never);
}

export async function loadAgentMcpTools(input: {
  organizationId: string;
  agentId: string;
  runId: string;
  userId?: string | null;
  allowedToolIds?: readonly string[] | null;
  state: ToolRuntimeState;
}) {
  const [agent] = await db().select({ id: agents.id }).from(agents).where(and(
    eq(agents.id, input.agentId),
    eq(agents.organizationId, input.organizationId),
    eq(agents.status, "published"),
  )).limit(1);
  if (!agent) throw new ApiError(422, "AGENT_UNAVAILABLE", "الوكيل غير موجود أو غير منشور.");

  const rows = await db().select({
    approvalMode: agentMcpTools.approvalMode,
    maxCallsPerRun: agentMcpTools.maxCallsPerRun,
    tool: mcpTools,
    server: mcpServers,
  }).from(agentMcpTools)
    .innerJoin(mcpTools, eq(mcpTools.id, agentMcpTools.toolId))
    .innerJoin(mcpServers, eq(mcpServers.id, mcpTools.serverId))
    .where(and(
      eq(agentMcpTools.organizationId, input.organizationId),
      eq(agentMcpTools.agentId, input.agentId),
      eq(mcpTools.organizationId, input.organizationId),
      eq(mcpTools.enabled, true),
      eq(mcpServers.organizationId, input.organizationId),
      eq(mcpServers.enabled, true),
      eq(mcpServers.status, "connected"),
    ));
  const allowlist = input.allowedToolIds === undefined || input.allowedToolIds === null
    ? null
    : new Set(input.allowedToolIds);
  const effectiveRows = allowlist ? rows.filter((row) => allowlist.has(row.tool.id)) : rows;

  const bindings = new Map<string, AgentToolBinding>();
  const tools: ToolSet = {};
  for (const row of effectiveRows) {
    const safeName = safeToolName(row.tool.id);
    const approvalMode = row.approvalMode === "always" || row.approvalMode === "never"
      ? row.approvalMode
      : "risk_based";
    const binding: AgentToolBinding = {
      safeName,
      toolId: row.tool.id,
      serverId: row.server.id,
      originalName: row.tool.name,
      title: row.tool.title,
      description: row.tool.description,
      approvalMode,
      risk: row.tool.risk,
      capability: row.tool.capability,
      annotations: row.tool.annotations,
      maxCallsPerRun: row.maxCallsPerRun,
    };
    bindings.set(safeName, binding);
    const schema = validInputSchema(row.tool.inputSchema);
    tools[safeName] = dynamicTool({
      title: row.tool.title ?? row.tool.name,
      description: [
        row.tool.description ?? row.tool.name,
        `MCP server: ${row.server.name}. Original tool: ${row.tool.name}.`,
      ].join(" "),
      inputSchema: aiJsonSchema(schema),
      outputSchema: row.tool.outputSchema ? aiJsonSchema(row.tool.outputSchema) : undefined,
      needsApproval: (rawArguments) => evaluateToolApproval({
        approvalMode,
        risk: row.tool.risk,
        capability: row.tool.capability,
        name: row.tool.name,
        description: row.tool.description,
        annotations: row.tool.annotations,
        arguments: objectArguments(rawArguments),
      }).requiresApproval,
      execute: async (rawArguments, options) => {
        const args = objectArguments(rawArguments);
        const policy = evaluateToolApproval({
          approvalMode,
          risk: row.tool.risk,
          capability: row.tool.capability,
          name: row.tool.name,
          description: row.tool.description,
          annotations: row.tool.annotations,
          arguments: args,
        });
        const executed = await executeMcpToolIdempotent({
          organizationId: input.organizationId,
          agentId: input.agentId,
          toolId: row.tool.id,
          arguments: args,
          userId: input.userId,
          runId: input.runId,
          toolCallId: options.toolCallId,
          stepNumber: input.state.allocateStep(),
        });
        input.state.toolExecuted = true;
        input.state.toolResultSaved = true;
        input.state.sideEffectOccurred ||= policy.sideEffectful;
        return executed.result ?? { status: "running", callId: executed.call.id };
      },
    });
  }
  return { tools, bindings, hasTools: effectiveRows.length > 0 };
}
