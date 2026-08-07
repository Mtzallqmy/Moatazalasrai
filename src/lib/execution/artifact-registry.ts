import type { ExecutionLimits } from "@/lib/execution/contracts";
import {
  executionArtifactDownload,
  listExecutionArtifacts,
  storeExecutionArtifact,
} from "@/lib/execution/artifact-service";

export type RegisterExecutionArtifactInput = {
  organizationId: string;
  userId: string;
  jobId: string;
  stepId?: string;
  sourcePath: string;
  filename: string;
  kind: string;
  content: AsyncIterable<Uint8Array>;
  limits: ExecutionLimits;
  metadata?: Record<string, unknown>;
};

/**
 * Shared artifact boundary for every Execution Kernel consumer.
 * Tool implementations register outputs here instead of writing directly to storage or execution_artifacts.
 */
export class ArtifactRegistry {
  register(input: RegisterExecutionArtifactInput) {
    return storeExecutionArtifact(input);
  }

  list(input: { organizationId: string; jobId: string; page?: number; limit?: number }) {
    return listExecutionArtifacts({
      organizationId: input.organizationId,
      jobId: input.jobId,
      page: input.page ?? 1,
      limit: input.limit ?? 50,
    });
  }

  download(input: { organizationId: string; jobId: string; artifactId: string }) {
    return executionArtifactDownload(input);
  }
}

export const artifactRegistry = new ArtifactRegistry();
