import type { ZodType } from "zod";
import type {
  BrowserRiskLevel,
  SitePermissionAction,
} from "@/lib/site-connections/policy";

export type SiteConnectorType = "oauth" | "api" | "browser";

export type ConnectionValidationResult = {
  status: "verified" | "pending";
  metadata: Record<string, unknown>;
  grantedScopes: string[];
  allowedDomains: string[];
  expiresAt?: Date;
};

export type ConnectorActionDefinition = {
  id: string;
  displayName: string;
  inputSchema: ZodType<unknown>;
  risk: BrowserRiskLevel;
  requiredPermission: SitePermissionAction;
  approval: "never" | "policy" | "always";
  timeoutMs: number;
  verifyResult(result: unknown): boolean;
};

export type ConnectorExecutionContext = {
  organizationId: string;
  connectionId: string;
  credentials: Record<string, unknown>;
  signal?: AbortSignal;
};

export type ConnectorActionRequest = {
  action: string;
  input: unknown;
};

export type ConnectorActionResult = {
  data: unknown;
  verified: boolean;
  metadata?: Record<string, unknown>;
};

export interface SiteConnector {
  id: string;
  displayName: string;
  type: SiteConnectorType;
  validateConnection(input: unknown): Promise<ConnectionValidationResult>;
  getAvailableActions(): readonly ConnectorActionDefinition[];
  executeAction(
    context: ConnectorExecutionContext,
    action: ConnectorActionRequest,
  ): Promise<ConnectorActionResult>;
  revokeConnection?(context: ConnectorExecutionContext): Promise<void>;
}
