import { and, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeBases, knowledgeChunks, knowledgeDocuments } from "@/db/schema";
export async function retrieveKnowledge(input: { organizationId: string; knowledgeBaseId: string; query: string; limit?: number }) {
  const terms = input.query.trim().split(/\s+/).filter((term) => term.length > 2).slice(0, 3);
  const pattern = `%${terms[0] ?? input.query.slice(0, 50)}%`;
  const rows = await db().select({
    chunkId: knowledgeChunks.id, documentId: knowledgeDocuments.id, title: knowledgeDocuments.title,
    content: knowledgeChunks.content, index: knowledgeChunks.chunkIndex,
  }).from(knowledgeChunks)
    .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgeChunks.documentId))
    .innerJoin(knowledgeBases, eq(knowledgeBases.id, knowledgeDocuments.knowledgeBaseId))
    .where(and(eq(knowledgeChunks.organizationId, input.organizationId), eq(knowledgeBases.organizationId, input.organizationId),
      eq(knowledgeBases.id, input.knowledgeBaseId), eq(knowledgeDocuments.status, "ready"), ilike(knowledgeChunks.content, pattern)))
    .limit(Math.min(input.limit ?? 5, 10));
  return {
    text: rows.map((row) => `[${row.title}#${row.index}]\n${row.content}`).join("\n\n"),
    citations: rows.map((row) => ({ documentId: row.documentId, chunkId: row.chunkId, title: row.title, score: 1, excerpt: row.content.slice(0, 240) })),
  };
}
