import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, toolApprovals } from "@/db/schema";
import type { Role } from "@/lib/auth/authorization";
import { assertToolAllowed, requiresApproval } from "./policy";
import { platformTools } from "./platform";
import type { RuntimeContext } from "../runtime/contracts";

export function toolInputDigest(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export async function executeRegisteredTool(input: {
  toolId: string; value: unknown; role: Role; context: RuntimeContext; approvalId?: string;
}) {
  const tool = platformTools.get(input.toolId);
  const parsed = tool.inputSchema.parse(input.value);
  let approved = !requiresApproval(tool);
  if (input.approvalId) {
    const digest = toolInputDigest(parsed);
    const [approval] = await db().select().from(toolApprovals).where(and(
      eq(toolApprovals.id, input.approvalId), eq(toolApprovals.organizationId, input.context.organizationId),
      eq(toolApprovals.toolId, tool.id), eq(toolApprovals.inputDigest, digest), eq(toolApprovals.status, "approved"),
    )).limit(1);
    approved = Boolean(approval && approval.expiresAt > new Date());
  }
  assertToolAllowed(tool, input.role, approved);
  const result = await Promise.race([
    tool.execute(parsed, { ...input.context, approvedByUser: approved }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TOOL_TIMEOUT")), tool.timeoutMs)),
  ]);
  await db().transaction(async (tx) => {
    if (input.approvalId) await tx.update(toolApprovals).set({ status: "consumed" }).where(and(
      eq(toolApprovals.id, input.approvalId), eq(toolApprovals.organizationId, input.context.organizationId),
    ));
    await tx.insert(auditLogs).values({
      organizationId: input.context.organizationId, actorType: "user", actorId: input.context.userId,
      action: "tool.executed", resourceType: "tool", resourceId: tool.id,
      metadata: { requestId: input.context.requestId, runId: input.context.runId, risk: tool.risk },
    });
  });
  return result;
}
