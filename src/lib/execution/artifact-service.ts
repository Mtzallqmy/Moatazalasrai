import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { executionArtifacts, executionJobs, executionUsage } from "@/db/execution-schema";
import type { ExecutionLimits } from "@/lib/execution/contracts";
import { ExecutionError } from "@/lib/execution/errors";
import { appendExecutionEvent } from "@/lib/execution/event-service";
import { safeFilename } from "@/lib/execution/validation";
import { objectStorage } from "@/lib/storage/object-storage";

const artifactKinds = new Set([
  "source", "report", "image", "chart", "archive", "log", "patch", "binary", "dataset", "audio", "video", "test-result",
]);

async function collect(content: AsyncIterable<Uint8Array>, maximum: number) {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of content) {
    bytes += chunk.byteLength;
    if (bytes > maximum) throw new ExecutionError("EXECUTION_ARTIFACT_LIMIT", "تجاوز الملف حد Artifact المسموح.");
    chunks.push(chunk);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

function detectedMediaType(body: Uint8Array) {
  const bytes = Buffer.from(body);
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";
  if (bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) return "application/zip";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.includes(0)) return "application/octet-stream";
  const text = bytes.toString("utf8");
  if (Buffer.from(text, "utf8").length !== bytes.length) return "application/octet-stream";
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { JSON.parse(trimmed); return "application/json"; } catch {}
  }
  return "text/plain; charset=utf-8";
}

function retentionDate() {
  const configured = Number(process.env.EXECUTION_ARTIFACT_RETENTION_DAYS ?? 7);
  const days = Number.isSafeInteger(configured) ? Math.min(Math.max(configured, 1), 90) : 7;
  return new Date(Date.now() + days * 86_400_000);
}

export async function storeExecutionArtifact(input: {
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
}) {
  if (!artifactKinds.has(input.kind)) throw new ExecutionError("EXECUTION_ARTIFACT_INVALID", "نوع Artifact غير مدعوم.");
  const body = await collect(input.content, Math.min(input.limits.maxArtifactBytes, input.limits.maxSingleFileBytes));
  if (!body.byteLength) throw new ExecutionError("EXECUTION_ARTIFACT_INVALID", "لا يمكن تخزين Artifact فارغ.");
  const [job] = await db().select({ id: executionJobs.id }).from(executionJobs).where(and(
    eq(executionJobs.id, input.jobId),
    eq(executionJobs.organizationId, input.organizationId),
    eq(executionJobs.userId, input.userId),
  )).limit(1);
  if (!job) throw new ExecutionError("EXECUTION_NOT_FOUND", "عملية التنفيذ غير موجودة.");

  const artifactId = randomUUID();
  const key = `${input.organizationId}/${artifactId}`;
  const sha256 = createHash("sha256").update(body).digest("hex");
  const mediaType = detectedMediaType(body);
  const filename = safeFilename(input.filename);
  const storage = objectStorage();
  await storage.put({ key, body, contentType: mediaType, sha256 });
  try {
    const [artifact] = await db().transaction(async (tx) => {
      const [created] = await tx.insert(executionArtifacts).values({
        id: artifactId,
        organizationId: input.organizationId,
        jobId: input.jobId,
        stepId: input.stepId,
        storageKey: key,
        filename,
        mediaType,
        sizeBytes: body.byteLength,
        sha256,
        kind: input.kind,
        metadata: { sourcePath: input.sourcePath, ...(input.metadata ?? {}) },
        retentionUntil: retentionDate(),
      }).returning();
      await tx.update(executionUsage).set({
        artifactBytes: body.byteLength,
        updatedAt: new Date(),
      }).where(and(
        eq(executionUsage.organizationId, input.organizationId),
        eq(executionUsage.jobId, input.jobId),
      ));
      return [created];
    });
    if (!artifact) throw new Error("EXECUTION_ARTIFACT_CREATE_FAILED");
    await appendExecutionEvent({
      organizationId: input.organizationId,
      jobId: input.jobId,
      type: "artifact.stored",
      source: "worker",
      payload: { artifactId, filename, mediaType, sizeBytes: body.byteLength, sha256 },
    });
    return artifact;
  } catch (error) {
    await storage.delete(key).catch(() => undefined);
    throw error;
  }
}

export async function listExecutionArtifacts(input: {
  organizationId: string;
  jobId: string;
  page: number;
  limit: number;
}) {
  return db().select({
    id: executionArtifacts.id,
    filename: executionArtifacts.filename,
    mediaType: executionArtifacts.mediaType,
    sizeBytes: executionArtifacts.sizeBytes,
    sha256: executionArtifacts.sha256,
    kind: executionArtifacts.kind,
    metadata: executionArtifacts.metadata,
    createdAt: executionArtifacts.createdAt,
  }).from(executionArtifacts).where(and(
    eq(executionArtifacts.organizationId, input.organizationId),
    eq(executionArtifacts.jobId, input.jobId),
  )).orderBy(desc(executionArtifacts.createdAt))
    .limit(input.limit)
    .offset((input.page - 1) * input.limit);
}

export async function executionArtifactDownload(input: {
  organizationId: string;
  jobId: string;
  artifactId: string;
}) {
  const [artifact] = await db().select().from(executionArtifacts).where(and(
    eq(executionArtifacts.id, input.artifactId),
    eq(executionArtifacts.organizationId, input.organizationId),
    eq(executionArtifacts.jobId, input.jobId),
  )).limit(1);
  if (!artifact) throw new ExecutionError("EXECUTION_ARTIFACT_NOT_FOUND", "Artifact غير موجود.");
  const storage = objectStorage();
  if (storage.driver === "r2") {
    return { artifact, url: await storage.createSignedDownloadUrl(artifact.storageKey, 300), body: null };
  }
  return { artifact, url: null, body: await storage.get(artifact.storageKey) };
}
