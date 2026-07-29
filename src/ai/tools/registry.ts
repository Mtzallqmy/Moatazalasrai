import type { z } from "zod";
import type { ApprovalMode, RuntimeContext, ToolRisk } from "../runtime/contracts";
export interface ToolExecutionContext extends RuntimeContext { approvedByUser: boolean }
export interface RegisteredTool<TInput = unknown, TOutput = unknown> {
  id: string; name: string; description: string; inputSchema: z.ZodType<TInput>;
  risk: ToolRisk; approvalMode: ApprovalMode; timeoutMs: number;
  requiredRoles: Array<"owner" | "admin" | "developer" | "operator" | "viewer">;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  register(tool: RegisteredTool) {
    if (!/^[a-z0-9][a-z0-9._-]{2,80}$/.test(tool.id)) throw new Error("TOOL_ID_INVALID");
    if (this.tools.has(tool.id)) throw new Error("TOOL_DUPLICATE");
    this.tools.set(tool.id, tool);
  }
  get(id: string) {
    const tool = this.tools.get(id);
    if (!tool) throw new Error("TOOL_NOT_ALLOWED");
    return tool;
  }
  definitions() {
    return [...this.tools.values()].map((tool) => ({
      id: tool.id, name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
      risk: tool.risk, approvalMode: tool.approvalMode, timeoutMs: tool.timeoutMs, requiredRoles: tool.requiredRoles,
    }));
  }
}
