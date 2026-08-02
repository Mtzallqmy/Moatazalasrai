import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sandboxWorkspaces } from "@/db/sandbox-schema";
import { auditLogs } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { normalizeWorkspacePath } from "@/lib/sandbox/policy";
import { readRunnerFile } from "@/lib/sandbox/runner-client";
import { storeAttachment } from "@/lib/storage/attachments";
import type { SandboxActor } from "@/lib/sandbox/service";

function safeMime(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".txt") || lower.endsWith(".log")) return "text/plain";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "text/typescript";
  if (lower.endsWith(".html")) return "text/html";
  if (lower.endsWith(".css")) return "text/css";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".zip")) return "application/zip";
  throw new ApiError(415, "SANDBOX_ARTIFACT_TYPE_UNSUPPORTED", "نوع الملف غير مدعوم للتنزيل الآمن.");
}

export async function exportSandboxArtifact(input: {
  actor: SandboxActor;
  workspaceId: string;
  path: string;
  requestId: string;
}) {
  const [workspace] = await db().select({
    id: sandboxWorkspaces.id,
    createdByUserId: sandboxWorkspaces.createdByUserId,
    externalWorkspaceId: sandboxWorkspaces.externalWorkspaceId,
    status: sandboxWorkspaces.status,
  }).from(sandboxWorkspaces).where(and(
    eq(sandboxWorkspaces.id, input.workspaceId),
    eq(sandboxWorkspaces.organizationId, input.actor.organizationId),
    input.actor.role === "member" ? eq(sandboxWorkspaces.createdByUserId, input.actor.userId) : undefined,
  )).limit(1);
  if (!workspace || workspace.status !== "ready" || !workspace.externalWorkspaceId) {
    throw new ApiError(404, "SANDBOX_WORKSPACE_NOT_FOUND", "مساحة Sandbox غير متاحة.");
  }
  const path = normalizeWorkspacePath(input.path);
  const result = await readRunnerFile({
    tenantId: input.actor.organizationId,
    externalWorkspaceId: workspace.externalWorkspaceId,
    path,
    maxBytes: 10 * 1024 * 1024,
  });
  if (result.encoding !== "base64" && result.encoding !== "utf8") {
    throw new ApiError(422, "SANDBOX_ARTIFACT_INVALID", "تعذر قراءة الملف الناتج.");
  }
  const content = result.encoding === "base64"
    ? Buffer.from(result.content, "base64")
    : Buffer.from(result.content, "utf8");
  const filename = path.split("/").at(-1) ?? "artifact";
  const attachment = await storeAttachment({
    organizationId: input.actor.organizationId,
    uploadedByUserId: input.actor.userId,
    source: "web",
    filename,
    mimeType: safeMime(filename),
    content,
  });
  await db().insert(auditLogs).values({
    organizationId: input.actor.organizationId,
    actorType: "user",
    actorId: input.actor.userId,
    action: "sandbox.artifact_exported",
    resourceType: "attachment",
    resourceId: attachment.id,
    metadata: { workspaceId: workspace.id, path, sizeBytes: attachment.sizeBytes, requestId: input.requestId },
  });
  return {
    attachmentId: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    downloadPath: `/api/dashboard/files/${attachment.id}/download`,
  };
}
