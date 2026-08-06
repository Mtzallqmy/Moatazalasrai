import type { Role, Permission } from "@/lib/auth/permissions";
import type { WhatsAppIncomingMessage } from "@/lib/integrations/whatsapp/webhook";
import type { WhatsAppSession } from "./session-service";

export type WhatsAppLinkedIdentity = {
  connectionId: string;
  userId: string;
  organizationId: string;
  name: string | null;
  email: string;
  role: Role;
  permissions: ReadonlySet<Permission>;
  channelFeatures: ReadonlySet<string>;
};

export type WhatsAppRuntimeContext = {
  message: WhatsAppIncomingMessage;
  identity: WhatsAppLinkedIdentity;
  session: WhatsAppSession;
  requestId: string;
};

export type WhatsAppCapabilityHandler = (context: WhatsAppRuntimeContext) => Promise<void>;

export type WhatsAppCapability = {
  id: string;
  section: "smart_work" | "knowledge" | "integrations" | "operations" | "administration";
  labelAr: string;
  descriptionAr: string;
  icon?: string;
  requiredPermission: Permission;
  whatsappFeatureKey: string;
  requiredPlatformModule?: string;
  visibilityResolver?: (context: WhatsAppRuntimeContext) => Promise<boolean>;
  handler: WhatsAppCapabilityHandler;
  emptyStateHandler?: WhatsAppCapabilityHandler;
  fallbackDashboardUrl: string;
  supportsPagination: boolean;
  destructive: boolean;
  adminOnly: boolean;
};
