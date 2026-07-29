import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentMemories, agents, auditLogs } from "@/db/schema";
import { aiFeatureEnabled } from "@/ai/config";
import { isUnsafeToMemorize, redactMemoryInput } from "@/ai/memory/redaction";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { uuidSchema } from "@/lib/http/contracts";
const createSchema = z.object({ kind: z.enum(["semantic", "procedural", "episodic"]), content: z.string().trim().min(1).max(4000), agentId: uuidSchema.optional(), importance: z.number().min(0).max(1).default(0.5) }).strict();
const deleteSchema = z.object({ id: uuidSchema }).strict();
function enabled() { if (!aiFeatureEnabled("MEMORY")) throw new ApiError(404, "FEATURE_DISABLED", "ميزة الذاكرة غير مفعلة."); }
export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    enabled(); const session = await requireSession("agents:run");
    const rows = await db().select().from(agentMemories).where(and(eq(agentMemories.organizationId, session.organizationId),
      eq(agentMemories.userId, session.userId), eq(agentMemories.enabled, true),
      or(isNull(agentMemories.expiresAt), sql`${agentMemories.expiresAt} > now()`))).orderBy(desc(agentMemories.createdAt)).limit(100);
    return apiSuccess(rows, requestId);
  } catch (error) { return handleApiError(error, requestId, "/api/memories"); }
}
export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    enabled(); assertSameOrigin(request); const session = await requireSession("agents:run");
    const body = await parseJson(request, createSchema, 8 * 1024);
    if (isUnsafeToMemorize(body.content)) throw new ApiError(422, "MEMORY_SENSITIVE", "رفض حفظ محتوى يبدو أنه يحتوي سرًا.");
    if (body.agentId) {
      const [agent] = await db().select({ id: agents.id }).from(agents).where(and(eq(agents.id, body.agentId), eq(agents.organizationId, session.organizationId))).limit(1);
      if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "الوكيل غير موجود.");
    }
    const [created] = await db().transaction(async (tx) => {
      const [row] = await tx.insert(agentMemories).values({ organizationId: session.organizationId, userId: session.userId,
        agentId: body.agentId, kind: body.kind, content: redactMemoryInput(body.content), importanceMilli: Math.round(body.importance * 1000) }).returning();
      await tx.insert(auditLogs).values({ organizationId: session.organizationId, actorType: "user", actorId: session.userId,
        action: "memory.created", resourceType: "agent_memory", resourceId: row!.id, metadata: { requestId, kind: body.kind } });
      return [row];
    });
    return apiSuccess(created, requestId, 201);
  } catch (error) { return handleApiError(error, requestId, "/api/memories"); }
}
export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    enabled(); assertSameOrigin(request); const session = await requireSession("agents:run");
    const body = await parseJson(request, deleteSchema, 4096);
    const deleted = await db().transaction(async (tx) => {
      const [row] = await tx.delete(agentMemories).where(and(eq(agentMemories.id, body.id), eq(agentMemories.organizationId, session.organizationId), eq(agentMemories.userId, session.userId))).returning({ id: agentMemories.id });
      if (!row) throw new ApiError(404, "MEMORY_NOT_FOUND", "الذاكرة غير موجودة.");
      await tx.insert(auditLogs).values({ organizationId: session.organizationId, actorType: "user", actorId: session.userId,
        action: "memory.deleted", resourceType: "agent_memory", resourceId: row.id, metadata: { requestId } });
      return row;
    });
    return apiSuccess({ deleted: true, id: deleted.id }, requestId);
  } catch (error) { return handleApiError(error, requestId, "/api/memories"); }
}
