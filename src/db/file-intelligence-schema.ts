import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { attachments, conversations, organizations } from "./schema";

export type AttachmentIntelligenceStatus =
  | "uploaded"
  | "processing"
  | "ready"
  | "partially_ready"
  | "failed"
  | "unsupported";

export const attachmentIntelligence = pgTable("attachment_intelligence", {
  attachmentId: uuid("attachment_id").primaryKey().references(() => attachments.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  status: text("status").$type<AttachmentIntelligenceStatus>().notNull().default("uploaded"),
  detectedType: text("detected_type").notNull(),
  category: text("category").notNull(),
  extractionVersion: text("extraction_version").notNull().default("file-intelligence-v1"),
  extractedChars: integer("extracted_chars").notNull().default(0),
  chunkCount: integer("chunk_count").notNull().default(0),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  extractedAt: timestamp("extracted_at", { withTimezone: true }),
  indexedAt: timestamp("indexed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("attachment_intelligence_org_status_idx").on(table.organizationId, table.status, table.updatedAt),
  index("attachment_intelligence_conversation_idx").on(table.organizationId, table.conversationId, table.updatedAt),
]);

export const attachmentChunks = pgTable("attachment_chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  attachmentId: uuid("attachment_id").notNull().references(() => attachments.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  tokenEstimate: integer("token_estimate").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("attachment_chunks_attachment_index_unique_idx").on(table.attachmentId, table.chunkIndex),
  index("attachment_chunks_scope_idx").on(table.organizationId, table.conversationId, table.attachmentId),
]);
