import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { featureFlags } from "@/db/control-plane-schema";

export function evaluateFeatureRollout(input: {
  enabled: boolean;
  rolloutPercentage: number;
  subject?: string | null;
}) {
  if (!input.enabled || input.rolloutPercentage <= 0) return false;
  if (input.rolloutPercentage >= 100 || !input.subject) return true;
  const digest = createHash("sha256").update(input.subject).digest();
  return digest.readUInt32BE(0) % 100 < input.rolloutPercentage;
}

export async function isFeatureEnabled(
  organizationId: string,
  key: string,
  subject?: string | null,
) {
  const [flag] = await db()
    .select({ enabled: featureFlags.enabled, rolloutPercentage: featureFlags.rolloutPercentage })
    .from(featureFlags)
    .where(and(eq(featureFlags.organizationId, organizationId), eq(featureFlags.key, key)))
    .limit(1);
  return flag ? evaluateFeatureRollout({ ...flag, subject }) : false;
}
