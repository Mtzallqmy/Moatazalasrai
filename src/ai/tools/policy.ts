import type { Role } from "@/lib/auth/authorization";
import type { RegisteredTool } from "./registry";
export function requiresApproval(tool: RegisteredTool) {
  return tool.approvalMode === "always" || (tool.approvalMode === "risk_based" && ["high", "critical"].includes(tool.risk));
}
export function assertToolAllowed(tool: RegisteredTool, role: Role, approved: boolean) {
  if (!tool.requiredRoles.includes(role)) throw new Error("TOOL_ROLE_FORBIDDEN");
  if (requiresApproval(tool) && !approved) throw new Error("TOOL_APPROVAL_REQUIRED");
}
