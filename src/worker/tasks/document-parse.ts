import type { Task } from "graphile-worker";
import { parseKnowledgeDocument } from "@/lib/documents/parse";
import { documentParsePayloadSchema } from "@/worker/schemas";

export const documentParseTask: Task = async (rawPayload, helpers) => {
  const payload = documentParsePayloadSchema.parse(rawPayload);
  helpers.logger.info(`document.parse started for ${payload.documentId}`);
  const result = await parseKnowledgeDocument({
    organizationId: payload.organizationId,
    documentId: payload.documentId,
    abortSignal: helpers.abortSignal,
  });
  helpers.logger.info(`document.parse completed with ${result.chunks} chunks`);
};
