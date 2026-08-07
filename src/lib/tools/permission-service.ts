import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { featureFlags, platformModules } from "@/db/control-plane-schema";
import { providerCredentials } from "@/db/schema";
import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { can, type Permission, type Role } from "@/lib/auth/permissions";
import { env } from "@/lib/config/env";
import { executionRunnerHealth } from "@/lib/execution/runner-registry";
import type { ToolAvailability, ToolManifest, ToolRunActor } from "@/lib/tools/contracts";

async function hasPermission(actor: ToolRunActor, permission: Permission) {
  if (can(actor.role as Role, permission)) return true;
  const custom = await loadCustomPermissions(actor.organizationId, actor.userId);
  return custom.includes(permission);
}

async function browserHealth() {
  const config = env();
  if (!config.browserAgentEnabled || !config.browserRunnerUrl || !config.browserRunnerSharedSecret) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(new URL("/health", `${config.browserRunnerUrl}/`), { cache: "no-store", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function hasVoiceProvider(organizationId: string) {
  const [provider] = await db().select({ id: providerCredentials.id }).from(providerCredentials).where(and(
    eq(providerCredentials.organizationId, organizationId),
    eq(providerCredentials.enabled, true),
    eq(providerCredentials.validationStatus, "verified"),
    eq(providerCredentials.provider, "openai"),
    isNull(providerCredentials.deletedAt),
  )).limit(1);
  return Boolean(provider || process.env.ELEVENLABS_API_KEY?.trim());
}

export async function resolveToolAvailability(manifest: ToolManifest, actor: ToolRunActor): Promise<ToolAvailability> {
  const reasons: string[] = [];
  if (!(await hasPermission(actor, manifest.requiredPermission))) reasons.push("permission_denied");

  const [[module], [flag]] = await Promise.all([
    db().select({ status: platformModules.status }).from(platformModules).where(and(
      eq(platformModules.organizationId, actor.organizationId),
      eq(platformModules.key, manifest.requiredModule),
    )).limit(1),
    db().select({ enabled: featureFlags.enabled, rolloutPercentage: featureFlags.rolloutPercentage }).from(featureFlags).where(and(
      eq(featureFlags.organizationId, actor.organizationId),
      eq(featureFlags.key, manifest.featureFlag),
    )).limit(1),
  ]);
  if (!module || module.status !== "active") reasons.push("module_disabled");
  if (!flag?.enabled || flag.rolloutPercentage <= 0) reasons.push("feature_flag_disabled");

  if (manifest.id === "data.interpreter" || manifest.id === "coding.agent") {
    const health = await executionRunnerHealth("existing_sandbox");
    if (!health.ok) reasons.push("sandbox_unhealthy");
  } else if (manifest.id === "browser.agent") {
    if (!(await browserHealth())) reasons.push("browser_unhealthy");
  } else if (manifest.id === "voice.studio") {
    if (!(await hasVoiceProvider(actor.organizationId))) reasons.push("voice_provider_unavailable");
  }

  return { available: reasons.length === 0, reasons };
}
