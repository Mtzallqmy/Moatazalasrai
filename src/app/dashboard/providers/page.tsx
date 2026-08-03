import { and, desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { CloudflareProviderForm } from "@/components/cloudflare-provider-form";
import { DashboardShell } from "@/components/dashboard-shell";
import { ProviderForm } from "@/components/provider-form";
import { ProviderManager } from "@/components/provider-manager";
import { PuterProviderCard } from "@/components/puter-provider-card";
import { db } from "@/db";
import { providerCredentials } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";
import { getProviderPreset } from "@/lib/providers/catalog";
import { asCredentialMode, asProviderTypeId, asTransportMode } from "@/lib/providers/provider-config";
import { isProviderHealthStatus } from "@/lib/providers/types";
import { inferProviderSlug } from "@/lib/providers/registry";
import { isPuterEnabled } from "@/lib/puter/feature";

export default async function ProvidersPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  if (!["owner", "admin", "developer"].includes(session.role)) redirect("/forbidden");
  const rows = await db().select({
    id: providerCredentials.id,
    provider: providerCredentials.provider,
    providerTypeId: providerCredentials.providerTypeId,
    transportMode: providerCredentials.transportMode,
    credentialMode: providerCredentials.credentialMode,
    name: providerCredentials.name,
    baseUrl: providerCredentials.baseUrl,
    gatewayId: providerCredentials.gatewayId,
    keyAlias: providerCredentials.keyAlias,
    gatewaySkipCache: providerCredentials.gatewaySkipCache,
    gatewayCacheTtl: providerCredentials.gatewayCacheTtl,
    gatewayCollectLog: providerCredentials.gatewayCollectLog,
    defaultModel: providerCredentials.defaultModel,
    allowedModels: providerCredentials.allowedModels,
    capabilities: providerCredentials.capabilities,
    secretHint: providerCredentials.secretHint,
    discoveredModels: providerCredentials.discoveredModels,
    validationStatus: providerCredentials.validationStatus,
    healthStatus: providerCredentials.healthStatus,
    lastValidatedAt: providerCredentials.lastValidatedAt,
    lastCheckedAt: providerCredentials.lastCheckedAt,
    lastSuccessfulAt: providerCredentials.lastSuccessfulAt,
    lastFailureAt: providerCredentials.lastFailureAt,
    lastValidationLatencyMs: providerCredentials.lastValidationLatencyMs,
    lastErrorCode: providerCredentials.lastErrorCode,
    lastErrorCategory: providerCredentials.lastErrorCategory,
    consecutiveFailures: providerCredentials.consecutiveFailures,
    circuitOpenUntil: providerCredentials.circuitOpenUntil,
    enabled: providerCredentials.enabled,
    isDefault: providerCredentials.isDefault,
    createdAt: providerCredentials.createdAt,
    updatedAt: providerCredentials.updatedAt,
  }).from(providerCredentials).where(and(
    eq(providerCredentials.organizationId, session.organizationId),
    sql`"provider_credentials"."deleted_at" IS NULL`,
  )).orderBy(desc(providerCredentials.isDefault), desc(providerCredentials.createdAt));

  return <DashboardShell session={session} activePath="/dashboard/providers" title="المزودون والنماذج" description="اختبار فعلي، حالات صحية دقيقة، وأسرار تُحفظ في موضعها الصحيح دون كشفها في الواجهة أو السجلات.">
    {isPuterEnabled() ? <PuterProviderCard /> : null}
    <CloudflareProviderForm />
    <ProviderForm />
    <ProviderManager initialProviders={rows.map((row) => {
      const providerTypeId = asProviderTypeId(row.providerTypeId, row.provider);
      const transportMode = asTransportMode(row.transportMode);
      const credentialMode = asCredentialMode(row.credentialMode);
      const healthStatus = isProviderHealthStatus(row.healthStatus) ? row.healthStatus : "unknown";
      const providerSlug = providerTypeId === "cloudflare-workers-ai"
        ? "cloudflare-workers-ai"
        : providerTypeId === "cloudflare-ai-gateway"
          ? "cloudflare-ai-gateway"
          : inferProviderSlug(row.provider, row.baseUrl);
      const preset = getProviderPreset(providerSlug);
      return {
        ...row,
        providerTypeId,
        transportMode,
        credentialMode,
        healthStatus,
        providerSlug,
        providerLabel: providerTypeId === "cloudflare-workers-ai"
          ? "Cloudflare Workers AI"
          : providerTypeId === "cloudflare-ai-gateway"
            ? "Cloudflare AI Gateway"
            : preset?.labelAr ?? preset?.label ?? providerSlug,
        apiStyle: transportMode === "cloudflare_workers_ai"
          ? "workers_ai_binding"
          : transportMode === "cloudflare_ai_gateway_rest"
            ? "cloudflare_rest_chat"
            : preset?.apiStyle ?? "openai_chat",
        lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
        lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
        lastSuccessfulAt: row.lastSuccessfulAt?.toISOString() ?? null,
        lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
        circuitOpenUntil: row.circuitOpenUntil?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    })} />
  </DashboardShell>;
}
