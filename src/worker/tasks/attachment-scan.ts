import type { Task } from "graphile-worker";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments, auditLogs } from "@/db/schema";
import { readAttachmentContent } from "@/lib/storage/attachments";
import { processFile } from "@/server/files/processor";
import { scanAttachmentForViruses } from "@/server/files/antivirus";
import { attachmentScanPayloadSchema } from "@/worker/schemas";

export const attachmentScanTask: Task = async (rawPayload, helpers) => {
  const payload = attachmentScanPayloadSchema.parse(rawPayload);
  const [file] = await db().select().from(attachments).where(and(
    eq(attachments.id, payload.attachmentId),
    eq(attachments.organizationId, payload.organizationId),
    isNull(attachments.deletedAt),
  )).limit(1);
  if (!file || file.processingStatus === "ready") return;

  helpers.logger.info(`attachment.scan started for ${file.id}`);
  try {
    const content = await readAttachmentContent(file);
    const antivirus = await scanAttachmentForViruses(content);
    if (antivirus.verdict === "infected") {
      await db().transaction(async (tx) => {
        await tx.update(attachments).set({
          processingStatus: "quarantined",
          processingErrorCode: "MALWARE_DETECTED",
          extractedText: null,
          updatedAt: new Date(),
        }).where(and(
          eq(attachments.id, file.id),
          eq(attachments.organizationId, payload.organizationId),
        ));
        await tx.insert(auditLogs).values({
          organizationId: payload.organizationId,
          actorType: "worker",
          action: "attachment.malware_detected",
          resourceType: "attachment",
          resourceId: file.id,
          metadata: { engine: antivirus.engine, signature: antivirus.signature ?? null },
        });
      });
      helpers.logger.warn(`attachment.scan quarantined ${file.id}`);
      return;
    }

    const processed = processFile(file.filename, file.mimeType, Buffer.from(content));
    await db().transaction(async (tx) => {
      await tx.update(attachments).set({
        detectedType: processed.detectedType,
        processingStatus: "ready",
        extractedText: processed.extractedText,
        archiveEntryCount: processed.archiveEntryCount,
        processingErrorCode: null,
        updatedAt: new Date(),
      }).where(and(
        eq(attachments.id, file.id),
        eq(attachments.organizationId, payload.organizationId),
      ));
      await tx.insert(auditLogs).values({
        organizationId: payload.organizationId,
        actorType: "worker",
        action: "attachment.scan_completed",
        resourceType: "attachment",
        resourceId: file.id,
        metadata: { engine: antivirus.engine, verdict: antivirus.verdict },
      });
    });
    helpers.logger.info(`attachment.scan completed for ${file.id}`);
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 120) : "ATTACHMENT_SCAN_FAILED";
    await db().update(attachments).set({
      processingStatus: "failed",
      processingErrorCode: errorCode,
      updatedAt: new Date(),
    }).where(and(
      eq(attachments.id, file.id),
      eq(attachments.organizationId, payload.organizationId),
    ));
    throw error;
  }
};
