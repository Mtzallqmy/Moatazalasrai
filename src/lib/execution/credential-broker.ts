import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { providerCredentials } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { asCredentialMode, asProviderTypeId, asTransportMode, resolveProviderApiKey } from "@/lib/providers/provider-config";

export type BrokeredProviderCredential = {
  id: string;
  provider: typeof providerCredentials.$inferSelect.provider;
  providerTypeId: ReturnType<typeof asProviderTypeId>;
  transportMode: ReturnType<typeof asTransportMode>;
  credentialMode: ReturnType<typeof asCredentialMode>;
  baseUrl: string;
  apiKey: string;
  gatewayId: string | null;
  keyAlias: string | null;
  defaultModel: string | null;
  allowedModels: string[];
  discoveredModels: string[];
  capabilities: Record<string, boolean>;
};

export class CredentialBroker {
  async resolveProviderCredential(input: {
    organizationId: string;
    providerCredentialId: string;
  }): Promise<BrokeredProviderCredential> {
    const [credential] = await db().select().from(providerCredentials).where(and(
      eq(providerCredentials.id, input.providerCredentialId),
      eq(providerCredentials.organizationId, input.organizationId),
      eq(providerCredentials.enabled, true),
      eq(providerCredentials.validationStatus, "verified"),
      isNull(providerCredentials.deletedAt),
    )).limit(1);
    if (!credential) {
      throw new ApiError(409, "EXECUTION_PROVIDER_UNAVAILABLE", "المزود المطلوب غير متاح أو غير موثق.");
    }
    const providerTypeId = asProviderTypeId(credential.providerTypeId, credential.provider);
    const transportMode = asTransportMode(credential.transportMode);
    const credentialMode = asCredentialMode(credential.credentialMode);
    const apiKey = resolveProviderApiKey(credential, input.organizationId);
    return {
      id: credential.id,
      provider: credential.provider,
      providerTypeId,
      transportMode,
      credentialMode,
      baseUrl: credential.baseUrl,
      apiKey,
      gatewayId: credential.gatewayId,
      keyAlias: credential.keyAlias,
      defaultModel: credential.defaultModel,
      allowedModels: credential.allowedModels,
      discoveredModels: credential.discoveredModels,
      capabilities: credential.capabilities,
    };
  }

  assertNoWorkspaceSecrets(payload: unknown) {
    const serialized = JSON.stringify(payload ?? {}).toLowerCase();
    for (const marker of ["api_key", "apikey", "access_token", "refresh_token", "authorization", "encrypted_secret"]) {
      if (serialized.includes(marker)) {
        throw new ApiError(500, "EXECUTION_SECRET_BOUNDARY_VIOLATION", "رفض النظام تمرير بيانات اعتماد إلى مساحة التنفيذ.");
      }
    }
  }
}

export const credentialBroker = new CredentialBroker();
