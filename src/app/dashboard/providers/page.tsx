import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { ProviderForm } from "@/components/provider-form";
import { ProviderManager } from "@/components/provider-manager";
import { db } from "@/db";
import { providerCredentials } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";

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
    enabled: providerCredentials.enabled,
    createdAt: providerCredentials.createdAt,
  }).from(providerCredentials).where(eq(providerCredentials.organizationId, session.organizationId)).orderBy(desc(providerCredentials.createdAt));

  return <DashboardShell session={session} activePath="/dashboard/providers" title="المزودون والنماذج" description="فحص API Key وBase URL فعليًا، جلب النماذج من المزود، ثم حفظ المفتاح مشفرًا.">
    <ProviderForm />
    <ProviderManager initialProviders={rows.map((row) => ({
      ...row,
      lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }))} />
  </DashboardShell>;
}
