import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { executionArtifacts, executionJobs, executionUsage, executionWorkspaces } from "@/db/execution-schema";
import { attachments } from "@/db/schema";
import { storeAttachment } from "@/lib/storage/attachments";
import { getExecutionRunner } from "@/lib/execution/runner-registry";
import { ApiError } from "@/lib/http/api";

function safeFilename(value: string) {
  const cleaned = value.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 180);
  if (!cleaned || cleaned === "." || cleaned === "..") throw new ApiError(422, "EXECUTION_ARTIFACT_NAME_INVALID", "اسم الملف الناتج غير صالح.");
  return cleaned;
}

function storageFilename(filename: string, mimeType: string) {
  const lower = filename.toLowerCase();
  const supported = [".pdf", ".json", ".csv", ".md", ".txt", ".log", ".js", ".mjs", ".ts", ".tsx", ".html", ".css", ".png", ".jpg", ".jpeg", ".webp", ".zip", ".xlsx", ".mp3", ".wav", ".ogg", ".mp4", ".webm"];
  if (supported.some((ext) => lower.endsWith(ext))) return filename;
  if (mimeType.startsWith("text/") || mimeType === "application/json") return `${filename}.txt`;
  return filename;
}

async function addArtifactUsage(organizationId: string, executionJobId: string, sizeBytes: number) {
  await db().update(executionUsage).set({
    artifactBytes: sql`${executionUsage.artifactBytes} + ${sizeBytes}`,
    updatedAt: new Date(),
  }).where(and(eq(executionUsage.executionJobId, executionJobId), eq(executionUsage.organizationId, organizationId)));
}

export class ArtifactRegistry {
  async registerBuffer(input: {
    organizationId: string;
    userId: string;
    executionJobId: string;
    executionStepId?: string;
    kind: string;
    filename: string;
    mimeType: string;
    content: Uint8Array;
    metadata?: Record<string, unknown>;
    workspacePath?: string;
  }) {
    const [job] = await db().select({ id: executionJobs.id, limits: executionJobs.limits }).from(executionJobs).where(and(
      eq(executionJobs.id, input.executionJobId), eq(executionJobs.organizationId, input.organizationId),
    )).limit(1);
    if (!job) throw new ApiError(404, "EXECUTION_JOB_NOT_FOUND", "مهمة التنفيذ غير موجودة.");
    if (input.content.byteLength === 0) throw new ApiError(422, "EXECUTION_ARTIFACT_EMPTY", "الملف الناتج فارغ.");
    if (input.content.byteLength > job.limits.maxArtifactBytes) throw new ApiError(413, "EXECUTION_ARTIFACT_TOO_LARGE", "الملف الناتج تجاوز الحد المسموح.");
    const filename = safeFilename(input.filename);
    const sha256 = createHash("sha256").update(input.content).digest("hex");
    const [existing] = await db().select().from(executionArtifacts).where(and(
      eq(executionArtifacts.executionJobId, input.executionJobId),
      eq(executionArtifacts.sha256, sha256),
      eq(executionArtifacts.filename, filename),
    )).limit(1);
    if (existing) return existing;
    const attachment = await storeAttachment({
      organizationId: input.organizationId,
      uploadedByUserId: input.userId,
      source: "api",
      filename: storageFilename(filename, input.mimeType),
      mimeType: input.mimeType,
      content: Buffer.from(input.content),
    });
    const [created] = await db().insert(executionArtifacts).values({
      organizationId: input.organizationId,
      executionJobId: input.executionJobId,
      executionStepId: input.executionStepId,
      attachmentId: attachment.id,
      kind: input.kind,
      filename,
      mimeType: input.mimeType,
      sizeBytes: input.content.byteLength,
      sha256,
      workspacePath: input.workspacePath,
      status: "ready",
      metadata: input.metadata ?? {},
    }).returning();
    if (!created) throw new Error("EXECUTION_ARTIFACT_CREATE_FAILED");
    await addArtifactUsage(input.organizationId, input.executionJobId, input.content.byteLength);
    return created;
  }

  async registerAttachment(input: {
    organizationId: string;
    executionJobId: string;
    executionStepId?: string;
    attachmentId: string;
    kind: string;
    metadata?: Record<string, unknown>;
  }) {
    const [[job], [attachment]] = await Promise.all([
      db().select({ id: executionJobs.id, limits: executionJobs.limits }).from(executionJobs).where(and(
        eq(executionJobs.id, input.executionJobId), eq(executionJobs.organizationId, input.organizationId),
      )).limit(1),
      db().select({ id: attachments.id, filename: attachments.filename, mimeType: attachments.mimeType, sizeBytes: attachments.sizeBytes, sha256: attachments.sha256 })
        .from(attachments).where(and(eq(attachments.id, input.attachmentId), eq(attachments.organizationId, input.organizationId))).limit(1),
    ]);
    if (!job) throw new ApiError(404, "EXECUTION_JOB_NOT_FOUND", "مهمة التنفيذ غير موجودة.");
    if (!attachment) throw new ApiError(404, "EXECUTION_ARTIFACT_SOURCE_MISSING", "الملف الناتج غير موجود.");
    if (attachment.sizeBytes <= 0 || attachment.sizeBytes > job.limits.maxArtifactBytes) throw new ApiError(413, "EXECUTION_ARTIFACT_TOO_LARGE", "الملف الناتج تجاوز الحد المسموح.");
    const [existing] = await db().select().from(executionArtifacts).where(and(
      eq(executionArtifacts.executionJobId, input.executionJobId), eq(executionArtifacts.attachmentId, attachment.id),
    )).limit(1);
    if (existing) return existing;
    const [created] = await db().insert(executionArtifacts).values({
      organizationId: input.organizationId,
      executionJobId: input.executionJobId,
      executionStepId: input.executionStepId,
      attachmentId: attachment.id,
      kind: input.kind,
      filename: safeFilename(attachment.filename),
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      sha256: attachment.sha256,
      status: "ready",
      metadata: input.metadata ?? {},
    }).returning();
    if (!created) throw new Error("EXECUTION_ARTIFACT_CREATE_FAILED");
    await addArtifactUsage(input.organizationId, input.executionJobId, attachment.sizeBytes);
    return created;
  }

  async exportWorkspaceFile(input: {
    organizationId: string;
    userId: string;
    executionJobId: string;
    path: string;
    kind: string;
    filename?: string;
    mimeType: string;
    metadata?: Record<string, unknown>;
  }) {
    const [job] = await db().select().from(executionJobs).where(and(
      eq(executionJobs.id, input.executionJobId), eq(executionJobs.organizationId, input.organizationId),
    )).limit(1);
    if (!job?.workspaceId) throw new ApiError(409, "EXECUTION_WORKSPACE_MISSING", "مهمة التنفيذ لا تملك مساحة ملفات.");
    const [workspace] = await db().select().from(executionWorkspaces).where(and(
      eq(executionWorkspaces.id, job.workspaceId), eq(executionWorkspaces.organizationId, input.organizationId),
    )).limit(1);
    if (!workspace?.externalWorkspaceRef || workspace.status !== "ready") throw new ApiError(409, "EXECUTION_WORKSPACE_NOT_READY", "مساحة التنفيذ غير جاهزة.");
    const runner = getExecutionRunner(job.runnerKind);
    const file = await runner.readFile({
      organizationId: input.organizationId,
      userId: input.userId,
      executionJobId: job.id,
      workspaceId: workspace.id,
      template: workspace.template,
      networkPolicy: workspace.networkPolicy,
      limits: workspace.limits,
      externalWorkspaceRef: workspace.externalWorkspaceRef,
      path: input.path,
      maxBytes: job.limits.maxArtifactBytes,
    });
    return this.registerBuffer({
      organizationId: input.organizationId,
      userId: input.userId,
      executionJobId: job.id,
      kind: input.kind,
      filename: input.filename ?? input.path.split("/").at(-1) ?? "artifact",
      mimeType: input.mimeType,
      content: file.content,
      metadata: input.metadata,
      workspacePath: input.path,
    });
  }

  list(input: { organizationId: string; executionJobId: string }) {
    return db().select().from(executionArtifacts).where(and(
      eq(executionArtifacts.organizationId, input.organizationId),
      eq(executionArtifacts.executionJobId, input.executionJobId),
    ));
  }
}

export const artifactRegistry = new ArtifactRegistry();
