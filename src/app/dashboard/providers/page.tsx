import { and, desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { ProviderForm } from "@/components/provider-form";
import { ProviderManager } from "@/components/provider-manager";
import { PuterProviderCard } from "@/components/puter-provider-card";
import { db } from "@/db";
import { providerCredentials } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";
import { getProviderPreset } from "@/lib/providers/catalog";
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
    name: providerCredentials.name,
    baseUrl: providerCredentials.baseUrl,
    secretHint: providerCredentials.secretHint,
    discoveredModels: providerCredentials.discoveredModels,
    validationStatus: providerCredentials.validationStatus,
    lastValidatedAt: providerCredentials.lastValidatedAt,
    lastValidationLatencyMs: providerCredentials.lastValidationLatencyMs,
    lastErrorCode: providerCredentials.lastErrorCode,
    consecutiveFailures: providerCredentials.consecutiveFailures,
    circuitOpenUntil: providerCredentials.circuitOpenUntil,
    enabled: providerCredentials.enabled,
    createdAt: providerCredentials.createdAt,
    updatedAt: providerCredentials.updatedAt,
  }).from(providerCredentials).where(and(
    eq(providerCredentials.organizationId, session.organizationId),
    sql`"provider_credentials"."deleted_at" IS NULL`,
  )).orderBy(desc(providerCredentials.createdAt));

  return <DashboardShell session={session} activePath="/dashboard/providers" title="المزودون والنماذج" description="اختبار مفاتيح API والنماذج فعليًا، إدارة دورة حياة الاتصالات، واستخدامها في الوكلاء والدردشات والتكاملات.">
    {isPuterEnabled() ? <PuterProviderCard /> : null}
    <ProviderForm />
    <ProviderManager initialProviders={rows.map((row) => {
      const providerSlug = inferProviderSlug(row.provider, row.baseUrl);
      const preset = getProviderPreset(providerSlug);
      return {
        ...row,
        providerSlug,
        providerLabel: preset?.labelAr ?? preset?.label ?? providerSlug,
        apiStyle: preset?.apiStyle ?? "openai_chat",
        lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
        circuitOpenUntil: row.circuitOpenUntil?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    })} />
  </DashboardShell>;
}
