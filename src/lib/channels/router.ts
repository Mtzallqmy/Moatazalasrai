// Central channel router validates permissions before delegating messages to the agent runtime.
import { ApiError } from "@/lib/http/api";
import type {
  ChannelPermission,
  ChannelRoutingPolicy,
  IncomingChannelMessage,
} from "./contracts";

export function assertChannelPermission(
  policy: ChannelRoutingPolicy,
  permission: ChannelPermission,
) {
  if (!policy.permissions.includes(permission)) {
    throw new ApiError(
      403,
      "CHANNEL_PERMISSION_DENIED",
      "لا يملك اتصال القناة صلاحية تنفيذ هذه العملية.",
      { permission },
    );
  }
}

export function assertAllowedChannelTool(policy: ChannelRoutingPolicy, toolId: string) {
  assertChannelPermission(policy, "tool.execute");
  if (!policy.allowedToolIds.includes(toolId)) {
    throw new ApiError(
      403,
      "CHANNEL_TOOL_NOT_ALLOWED",
      "الأداة المطلوبة غير مسموحة لهذا الاتصال.",
      { toolId },
    );
  }
}

export function assertAllowedChannelCommand(policy: ChannelRoutingPolicy, command: string) {
  if (!policy.allowedCommands.includes(command)) {
    throw new ApiError(
      403,
      "CHANNEL_COMMAND_NOT_ALLOWED",
      "الأمر المطلوب غير مسموح لهذا الاتصال.",
      { command },
    );
  }
}

export type ChannelRouteDecision = {
  action: "agent" | "human" | "handoff";
  reason: "configured_mode" | "user_request" | "outside_business_hours" | "agent_failure";
};

export function decideChannelRoute(
  message: IncomingChannelMessage,
  policy: ChannelRoutingPolicy,
  options: { outsideBusinessHours?: boolean; agentFailed?: boolean } = {},
): ChannelRouteDecision {
  const normalized = message.text.trim().toLowerCase();
  const requestedHuman = /(^|\s)(human|agent|موظف|بشري|خدمة العملاء)(\s|$)/i.test(normalized);

  if (requestedHuman && policy.permissions.includes("human.handoff")) {
    return { action: "handoff", reason: "user_request" };
  }
  if (options.agentFailed && policy.permissions.includes("human.handoff")) {
    return { action: "handoff", reason: "agent_failure" };
  }
  if (options.outsideBusinessHours && policy.mode === "rules") {
    return { action: "human", reason: "outside_business_hours" };
  }
  if (policy.mode === "human_only" || policy.mode === "human_then_ai") {
    return { action: "human", reason: "configured_mode" };
  }
  return { action: "agent", reason: "configured_mode" };
}
