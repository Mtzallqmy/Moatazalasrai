import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { providerCredentialHealthEvents } from "@/db/provider-health-schema";
import { providerCredentials } from "@/db/schema";
import { healthStatusForProviderError } from "@/lib/providers/errors";
import { ProviderError, type ProviderHealthStatus } from "@/lib/providers/types";

export class ProviderHealthService {
  async markValidating(input: { organizationId: string; providerCredentialId: string }) {
    await db().update(providerCredentials).set({
      healthStatus: "validating",
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(providerCredentials.id, input.providerCredentialId),
      eq(providerCredentials.organizationId, input.organizationId),
    ));
  }

  async markSuccess(input: {
    organizationId: string;
    providerCredentialId: string;
    model: string;
    runId?: string;
    requestId?: string;
    providerRequestId?: string;
    latencyMs?: number;
  }) {
    const now = new Date();
    await db().transaction(async (tx) => {
      await tx.update(providerCredentials).set({
        healthStatus: "healthy",
        validationStatus: "verified",
        lastCheckedAt: now,
        lastSuccessfulAt: now,
        lastErrorCode: null,
        lastErrorCategory: null,
        consecutiveFailures: 0,
        circuitOpenUntil: null,
        updatedAt: now,
      }).where(and(
        eq(providerCredentials.id, input.providerCredentialId),
        eq(providerCredentials.organizationId, input.organizationId),
      ));
      await tx.insert(providerCredentialHealthEvents).values({
        organizationId: input.organizationId,
        providerCredentialId: input.providerCredentialId,
        runId: input.runId,
        outcome: "completed",
        model: input.model,
        requestId: input.requestId,
        providerRequestId: input.providerRequestId,
        latencyMs: input.latencyMs,
        retryable: false,
      });
    });
  }

  async markFailure(input: {
    organizationId: string;
    providerCredentialId: string;
    model: string;
    error: ProviderError;
    runId?: string;
    requestId?: string;
    providerRequestId?: string;
    latencyMs?: number;
    consecutiveFailures: number;
    circuitOpenUntil?: Date | null;
  }) {
    const now = new Date();
    const healthStatus = healthStatusForProviderError(input.error);
    const invalid = healthStatus === "unauthorized" || healthStatus === "misconfigured";
    await db().transaction(async (tx) => {
      await tx.update(providerCredentials).set({
        healthStatus,
        lastCheckedAt: now,
        lastFailureAt: now,
        lastErrorCode: input.error.code,
        lastErrorCategory: input.error.category,
        consecutiveFailures: input.consecutiveFailures,
        circuitOpenUntil: input.circuitOpenUntil,
        ...(invalid ? { validationStatus: "failed" as const } : {}),
        updatedAt: now,
      }).where(and(
        eq(providerCredentials.id, input.providerCredentialId),
        eq(providerCredentials.organizationId, input.organizationId),
      ));
      await tx.insert(providerCredentialHealthEvents).values({
        organizationId: input.organizationId,
        providerCredentialId: input.providerCredentialId,
        runId: input.runId,
        outcome: "failed",
        model: input.model,
        errorCode: input.error.code,
        errorCategory: input.error.category,
        requestId: input.requestId,
        providerRequestId: input.providerRequestId,
        latencyMs: input.latencyMs,
        providerStatus: input.error.providerStatus,
        retryable: input.error.retryable,
        circuitOpenUntil: input.circuitOpenUntil,
      });
    });
  }

  status(enabled: boolean, configured: boolean, current?: string | null): ProviderHealthStatus {
    if (!enabled) return "disabled";
    if (!configured) return "unconfigured";
    const allowed = new Set<ProviderHealthStatus>([
      "unconfigured", "validating", "healthy", "degraded", "rate_limited", "unauthorized",
      "model_unavailable", "network_error", "misconfigured", "disabled", "unknown",
    ]);
    return allowed.has(current as ProviderHealthStatus) ? current as ProviderHealthStatus : "unknown";
  }
}

export const providerHealthService = new ProviderHealthService();
