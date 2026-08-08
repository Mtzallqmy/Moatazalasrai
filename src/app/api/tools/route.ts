import { aiFeatureEnabled } from "@/ai/config";
import { platformTools } from "@/ai/tools/platform";
import { checkDatabase } from "@/db";
import { requireSession } from "@/lib/auth/authorization";
import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { can, type Permission } from "@/lib/auth/permissions";
import { executionKernelEnabled } from "@/lib/execution/runner-registry";
import { executionRunnerHealth } from "@/lib/execution/runner-health";
import { apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { getToolAvailability } from "@/lib/tools/permission-service";
import { listToolManifests } from "@/lib/tools/registry";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession();
    const customPermissions = await loadCustomPermissions(session.organizationId, session.userId);
    const allowed = (permission: Permission) => can(session.role, permission) || customPermissions.includes(permission);

    const rows: Array<Record<string, unknown>> = [];
    if (aiFeatureEnabled("TOOLS") && allowed("agents:read")) {
      rows.push(...platformTools.definitions()
        .filter((tool) => tool.requiredRoles.includes(session.role))
        .map((tool) => ({ ...tool, kind: "agent_tool" })));
    }

    if (allowed("tools:read")) {
      let migrationsApplied = false;
      try {
        await checkDatabase();
        migrationsApplied = true;
      } catch {
        migrationsApplied = false;
      }

      let runnerHealthy = false;
      if (executionKernelEnabled()) {
        try {
          runnerHealthy = (await executionRunnerHealth(session.organizationId)).ready;
        } catch {
          runnerHealthy = false;
        }
      }

      for (const manifest of listToolManifests()) {
        const availability = await getToolAvailability({
          organizationId: session.organizationId,
          userId: session.userId,
          role: session.role,
          manifest,
          migrationsApplied,
          runnerHealthy,
          // Voice Studio stays hidden until a real provider adapter is implemented and healthy.
          providerAvailable: false,
        });
        if (!availability.visible) continue;
        rows.push({
          kind: "operational_tool",
          id: manifest.id,
          version: manifest.version,
          titleAr: manifest.titleAr,
          descriptionAr: manifest.descriptionAr,
          category: manifest.category,
          supportedInputs: manifest.supportedInputs,
          supportedOutputs: manifest.supportedOutputs,
          supportsFiles: manifest.supportsFiles,
          supportsStreaming: manifest.supportsStreaming,
          supportsCancellation: manifest.supportsCancellation,
          supportsResume: manifest.supportsResume,
          runnable: availability.runnable,
        });
      }
    }

    return apiSuccess(rows, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/tools");
  }
}
