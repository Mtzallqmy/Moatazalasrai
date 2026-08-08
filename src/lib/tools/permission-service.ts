import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { featureFlags, platformModules } from "@/db/control-plane-schema";
import { can, type Role } from "@/lib/auth/permissions";
import type { ToolManifest } from "./contracts";

function booleanEnv(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === "true";
}

export type ToolAvailability = {
  visible: boolean;
  runnable: boolean;
  reasons: string[];
};

export async function getToolAvailability(input: {
  organizationId: string;
  role: Role;
  manifest: ToolManifest;
  runnerHealthy?: boolean;
  providerAvailable?: boolean;
  migrationsApplied?: boolean;
}): Promise<ToolAvailability> {
  const reasons: string[] = [];
  const [moduleRow, flagRow] = await Promise.all([
    db().select({ status: platformModules.status }).from(platformModules).where(and(
      eq(platformModules.organizationId, input.organizationId),
      eq(platformModules.key, input.manifest.requiredModule),
    )).limit(1),
    db().select({ enabled: featureFlags.enabled }).from(featureFlags).where(and(
      eq(featureFlags.organizationId, input.organizationId),
      eq(featureFlags.key, input.manifest.id),
    )).limit(1),
  ]);

  if (!booleanEnv("TOOLS_RUNTIME_ENABLED")) reasons.push("TOOLS_RUNTIME_DISABLED");
  if (!booleanEnv(input.manifest.featureFlag)) reasons.push("TOOL_FEATURE_DISABLED");
  if (!can(input.role, "tools:read") || !can(input.role, input.manifest.requiredPermission)) reasons.push("PERMISSION_DENIED");
  if (moduleRow[0]?.status !== "active") reasons.push("MODULE_DISABLED");
  if (flagRow[0]?.enabled !== true) reasons.push("ORGANIZATION_FLAG_DISABLED");
  if (input.migrationsApplied !== true) reasons.push("MIGRATIONS_NOT_VERIFIED");
  if (input.manifest.executionKind === "execution_kernel" && input.runnerHealthy !== true) reasons.push("RUNNER_UNHEALTHY");
  if (input.manifest.executionKind === "provider" && input.providerAvailable !== true) reasons.push("PROVIDER_UNAVAILABLE");

  return {
    visible: reasons.length === 0,
    runnable: reasons.length === 0 && can(input.role, "tools:run"),
    reasons,
  };
}
