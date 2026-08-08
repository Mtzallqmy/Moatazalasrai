import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { agents, attachments, conversations, knowledgeBases, runs } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/authorization";
import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchResult = {
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  updatedAt: Date | null;
};

function boundedQuery(request: Request) {
  const raw = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  return raw.slice(0, 100);
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession();
    const query = boundedQuery(request);
    if (query.length < 2) {
      return apiSuccess({ query, groups: { conversations: [], agents: [], files: [], runs: [], knowledge: [] } }, requestId);
    }

    const customPermissions = await loadCustomPermissions(session.organizationId, session.userId);
    const allowed = (permission: Parameters<typeof can>[1]) => can(session.role, permission) || customPermissions.includes(permission);
    const pattern = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;

    const [conversationRows, agentRows, fileRows, runRows, knowledgeRows] = await Promise.all([
      allowed("agents:run")
        ? db().select({
            id: conversations.id,
            title: conversations.title,
            summary: conversations.summary,
            updatedAt: conversations.updatedAt,
          }).from(conversations).where(and(
            eq(conversations.organizationId, session.organizationId),
            isNull(conversations.deletedAt),
            or(ilike(conversations.title, pattern), ilike(conversations.summary, pattern)),
          )).orderBy(desc(conversations.updatedAt)).limit(5)
        : Promise.resolve([]),
      allowed("agents:read")
        ? db().select({
            id: agents.id,
            name: agents.name,
            description: agents.description,
            updatedAt: agents.updatedAt,
          }).from(agents).where(and(
            eq(agents.organizationId, session.organizationId),
            or(ilike(agents.name, pattern), ilike(agents.description, pattern)),
          )).orderBy(desc(agents.updatedAt)).limit(5)
        : Promise.resolve([]),
      allowed("files:read")
        ? db().select({
            id: attachments.id,
            filename: attachments.filename,
            mimeType: attachments.mimeType,
            updatedAt: attachments.updatedAt,
          }).from(attachments).where(and(
            eq(attachments.organizationId, session.organizationId),
            isNull(attachments.deletedAt),
            ilike(attachments.filename, pattern),
          )).orderBy(desc(attachments.updatedAt)).limit(5)
        : Promise.resolve([]),
      allowed("runs:read")
        ? db().select({
            id: runs.id,
            model: runs.model,
            status: runs.status,
            createdAt: runs.createdAt,
          }).from(runs).where(and(
            eq(runs.organizationId, session.organizationId),
            or(ilike(runs.model, pattern), ilike(runs.requestId, pattern)),
          )).orderBy(desc(runs.createdAt)).limit(5)
        : Promise.resolve([]),
      allowed("files:read")
        ? db().select({
            id: knowledgeBases.id,
            name: knowledgeBases.name,
            description: knowledgeBases.description,
            updatedAt: knowledgeBases.updatedAt,
          }).from(knowledgeBases).where(and(
            eq(knowledgeBases.organizationId, session.organizationId),
            or(ilike(knowledgeBases.name, pattern), ilike(knowledgeBases.description, pattern)),
          )).orderBy(desc(knowledgeBases.updatedAt)).limit(5)
        : Promise.resolve([]),
    ]);

    const groups: Record<string, SearchResult[]> = {
      conversations: conversationRows.map((row) => ({
        id: row.id,
        title: row.title?.trim() || "محادثة بدون عنوان",
        subtitle: row.summary?.trim() || null,
        href: `/dashboard/chat?conversation=${row.id}`,
        updatedAt: row.updatedAt,
      })),
      agents: agentRows.map((row) => ({
        id: row.id,
        title: row.name,
        subtitle: row.description?.trim() || null,
        href: `/dashboard/agents/${row.id}`,
        updatedAt: row.updatedAt,
      })),
      files: fileRows.map((row) => ({
        id: row.id,
        title: row.filename,
        subtitle: row.mimeType,
        href: `/dashboard/files?file=${row.id}`,
        updatedAt: row.updatedAt,
      })),
      runs: runRows.map((row) => ({
        id: row.id,
        title: `تشغيل ${row.id.slice(0, 8)}`,
        subtitle: `${row.model} · ${row.status}`,
        href: `/dashboard/runs/${row.id}`,
        updatedAt: row.createdAt,
      })),
      knowledge: knowledgeRows.map((row) => ({
        id: row.id,
        title: row.name,
        subtitle: row.description?.trim() || null,
        href: `/dashboard/knowledge?knowledgeBase=${row.id}`,
        updatedAt: row.updatedAt,
      })),
    };

    return apiSuccess({ query, groups }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/search");
  }
}
