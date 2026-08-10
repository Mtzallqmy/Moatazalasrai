import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentMcpTools, agents, auditLogs, mcpServers, mcpTools } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";

const updateSchema = z.object({
  agentId: z.string().uuid(),
  toolIds: z.array(z.string().uuid()).max(100),
}).strict();

export async function PUT(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("agents:manage");
    const body = await parseJson(request, updateSchema, 32 * 1024);
    const [agent] = await db().select({ id: agents.id }).from(agents).where(and(
      eq(agents.id, body.agentId),
      eq(agents.organizationId, session.organizationId),
    )).limit(1);
    if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "الوكيل غير موجود.");

    const uniqueToolIds = [...new Set(body.toolIds)];
    const validTools = uniqueToolIds.length ? await db().select({ id: mcpTools.id }).from(mcpTools)
      .innerJoin(mcpServers, eq(mcpServers.id, mcpTools.serverId))
      .where(and(
        eq(mcpTools.organizationId, session.organizationId),
        eq(mcpTools.enabled, true),
        eq(mcpServers.organizationId, session.organizationId),
        eq(mcpServers.enabled, true),
        eq(mcpServers.status, "connected"),
        inArray(mcpTools.id, uniqueToolIds),
      )) : [];
    if (validTools.length !== uniqueToolIds.length) {
      throw new ApiError(422, "MCP_TOOL_UNAVAILABLE", "إحدى أدوات MCP غير متاحة أو لم يعد خادمها متصلًا.");
    }

    await db().transaction(async (tx) => {
      await tx.delete(agentMcpTools).where(and(
        eq(agentMcpTools.organizationId, session.organizationId),
        eq(agentMcpTools.agentId, body.agentId),
      ));
      if (uniqueToolIds.length) {
        await tx.insert(agentMcpTools).values(uniqueToolIds.map((toolId) => ({
          organizationId: session.organizationId,
          agentId: body.agentId,
          toolId,
          approvalMode: "risk_based",
          maxCallsPerRun: 3,
        })));
      }
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "agent.mcp_tools.updated",
        resourceType: "agent",
        resourceId: body.agentId,
        metadata: { requestId, toolCount: uniqueToolIds.length },
      });
    });
    return apiSuccess({ agentId: body.agentId, toolIds: uniqueToolIds }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/agents/mcp");
  }
}
