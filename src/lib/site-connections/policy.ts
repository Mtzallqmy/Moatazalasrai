import { ApiError } from "@/lib/http/api";

export const SITE_PERMISSION_ACTIONS = [
  "read",
  "search",
  "navigate",
  "fill_form",
  "create",
  "update",
  "upload",
  "download",
  "send",
  "publish",
  "delete",
  "invite_users",
  "purchase",
  "payment",
  "account_settings",
  "security_settings",
] as const;

export const SITE_PERMISSION_POLICIES = ["allow", "require_approval", "deny"] as const;
export const BROWSER_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

export type SitePermissionAction = (typeof SITE_PERMISSION_ACTIONS)[number];
export type SitePermissionPolicy = (typeof SITE_PERMISSION_POLICIES)[number];
export type BrowserRiskLevel = (typeof BROWSER_RISK_LEVELS)[number];

export const DEFAULT_SITE_PERMISSION_POLICIES: Readonly<Record<SitePermissionAction, SitePermissionPolicy>> = {
  read: "allow",
  search: "allow",
  navigate: "allow",
  fill_form: "require_approval",
  create: "require_approval",
  update: "require_approval",
  upload: "require_approval",
  download: "require_approval",
  send: "require_approval",
  publish: "require_approval",
  delete: "require_approval",
  invite_users: "require_approval",
  purchase: "deny",
  payment: "deny",
  account_settings: "deny",
  security_settings: "deny",
};

export type PermissionDecision =
  | { outcome: "allow"; action: SitePermissionAction; policy: "allow"; risk: BrowserRiskLevel }
  | { outcome: "require_approval"; action: SitePermissionAction; policy: "require_approval"; risk: BrowserRiskLevel }
  | { outcome: "deny"; action: SitePermissionAction; policy: "deny"; risk: BrowserRiskLevel; reason: string };

const forcedApprovalActions = new Set<SitePermissionAction>([
  "send",
  "publish",
  "delete",
  "invite_users",
]);

const forcedDenyByDefaultActions = new Set<SitePermissionAction>([
  "purchase",
  "payment",
  "account_settings",
  "security_settings",
]);

export function completePermissionMap(
  overrides: Partial<Record<SitePermissionAction, SitePermissionPolicy>> = {},
): Record<SitePermissionAction, SitePermissionPolicy> {
  return Object.fromEntries(SITE_PERMISSION_ACTIONS.map((action) => [
    action,
    overrides[action] ?? DEFAULT_SITE_PERMISSION_POLICIES[action],
  ])) as Record<SitePermissionAction, SitePermissionPolicy>;
}

export function evaluateSitePermission(input: {
  action: SitePermissionAction;
  policy?: SitePermissionPolicy;
  risk: BrowserRiskLevel;
}): PermissionDecision {
  const policy = input.policy ?? DEFAULT_SITE_PERMISSION_POLICIES[input.action];

  if (policy === "deny") {
    return {
      outcome: "deny",
      action: input.action,
      policy,
      risk: input.risk,
      reason: "permission_policy_denied",
    };
  }

  if (forcedDenyByDefaultActions.has(input.action) && policy !== "allow") {
    return {
      outcome: "deny",
      action: input.action,
      policy: "deny",
      risk: input.risk,
      reason: "sensitive_action_requires_explicit_allow",
    };
  }

  if (
    policy === "require_approval"
    || forcedApprovalActions.has(input.action)
    || input.risk === "high"
    || input.risk === "critical"
  ) {
    return {
      outcome: "require_approval",
      action: input.action,
      policy: "require_approval",
      risk: input.risk,
    };
  }

  return { outcome: "allow", action: input.action, policy: "allow", risk: input.risk };
}

export function assertSitePermissionAllowed(decision: PermissionDecision) {
  if (decision.outcome === "deny") {
    throw new ApiError(403, "SITE_ACTION_DENIED", "سياسة الاتصال تمنع هذا الإجراء.", {
      action: decision.action,
      risk: decision.risk,
      reason: decision.reason,
    });
  }
  return decision;
}
