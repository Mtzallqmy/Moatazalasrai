import { requireSession } from "@/lib/auth/authorization";
import { executionArtifactDownload, listExecutionArtifacts } from "@/lib/execution/artifact-service";
import { executionArtifactsQuerySchema } from "@/lib/execution/contracts";
import { ExecutionError, executionErrorHttpStatus } from "@/lib/execution/errors";
import { getExecutionForActor } from "@/lib/execution/repository";
import { assertExecutionKernelEnabled } from "@/lib/execution/runner-registry";
import { ApiError, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { uuidSchema } from "@/lib/http/contracts";

function contentDisposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: Request, context: { params: Promise<{ executionId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertExecutionKernelEnabled();
    const session = await requireSession("executions:read");
    const executionId = uuidSchema.parse((await context.params).executionId);
    const actor = { organizationId: session.organizationId, userId: session.userId, role: session.role };
    await getExecutionForActor(actor, executionId);
    const url = new URL(request.url);
    const artifactId = url.searchParams.get("artifactId");
    if (artifactId) {
      const result = await executionArtifactDownload({
        organizationId: session.organizationId,
        jobId: executionId,
        artifactId: uuidSchema.parse(artifactId),
      });
      if (result.url) return Response.redirect(result.url, 302);
      if (!result.body) throw new ApiError(404, "EXECUTION_ARTIFACT_NOT_FOUND", "Artifact غير موجود.");
      const responseBody = Buffer.from(result.body.body);
      return new Response(responseBody, {
        status: 200,
        headers: {
          "content-type": result.artifact.mediaType,
          "content-length": String(result.body.sizeBytes),
          "content-disposition": contentDisposition(result.artifact.filename),
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "x-artifact-sha256": result.artifact.sha256,
          "x-request-id": requestId,
        },
      });
    }
    const query = executionArtifactsQuerySchema.parse(Object.fromEntries(url.searchParams));
    const rows = await listExecutionArtifacts({
      organizationId: session.organizationId,
      jobId: executionId,
      page: query.page,
      limit: query.limit,
    });
    return apiSuccess(rows.map((artifact) => ({
      ...artifact,
      downloadUrl: `/api/executions/${executionId}/artifacts?artifactId=${artifact.id}`,
    })), requestId);
  } catch (error) {
    if (error instanceof ExecutionError) {
      return handleApiError(new ApiError(executionErrorHttpStatus(error.code), error.code, error.message), requestId, "/api/executions/[executionId]/artifacts");
    }
    return handleApiError(error, requestId, "/api/executions/[executionId]/artifacts");
  }
}
