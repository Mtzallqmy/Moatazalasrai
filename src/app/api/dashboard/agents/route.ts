import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { agentVersions, agents, auditLogs, providerCredentials } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";

const writeRoles = new Set(["owner", "admin", "developer"]);

function id(request: Request) { return request.headers.get("x-request-id") ?? crypto.randomUUID(); }
function error(status: number, code: string, message: string, requestId: string) {
  return NextResponse.json({ success: false, error: { code, message, requestId } }, { status });
}

export async function GET(request: Request) {
  const requestId = id(request);
  const session = await currentSession().catch(() => null);
  if (!session?.organizationId) return error(401, "UNAUTHORIZED", "يجب تسجيل الدخول.", requestId);
  const rows = await db().select({
    id: agents.id,
    name: agents.name,
    description: agents.description,
    status: agents.status,
    model: agentVersions.model,
    providerCredentialId: agentVersions.providerCredentialId,
    updatedAt: agents.updatedAt,
  }).from(agents).innerJoin(agentVersions, and(eq(agentVersions.agentId, agents.id), eq(agentVersions.version, agents.currentVersion)))
    .where(eq(agents.organizationId, session.organizationId)).orderBy(desc(agents.updatedAt));
  return NextResponse.json({ success: true, data: rows, meta: { requestId } });
}

export async function POST(request: Request) {
  const requestId = id(request);
  const session = await currentSession().catch(() => null);
  if (!session?.organizationId || !session.role) return error(401, "UNAUTHORIZED", "يجب تسجيل الدخول.", requestId);
  if (!writeRoles.has(session.role)) return error(403, "FORBIDDEN", "لا تملك صلاحية إنشاء وكيل.", requestId);
  const body = await request.json().catch(() => null) as { name?: string; description?: string; providerCredentialId?: string; model?: string; instructions?: string; publish?: boolean } | null;
  const name = body?.name?.trim();
  const providerCredentialId = body?.providerCredentialId?.trim();
  const model = body?.model?.trim();
  const instructions = body?.instructions?.trim();
  if (!name || name.length > 100 || !providerCredentialId || !model || !instructions || instructions.length > 30000) return error(400, "VALIDATION_ERROR", "الاسم والمزود والنموذج والتعليمات مطلوبة.", requestId);
  const [credential] = await db().select({ id: providerCredentials.id, models: providerCredentials.discoveredModels }).from(providerCredentials).where(and(
    eq(providerCredentials.id, providerCredentialId),
    eq(providerCredentials.organizationId, session.organizationId),
    eq(providerCredentials.enabled, true),
  )).limit(1);
  if (!credential || !credential.models.includes(model)) return error(422, "MODEL_UNAVAILABLE", "النموذج غير موجود ضمن النماذج المحفوظة للمزود.", requestId);
  const [agent] = await db().insert(agents).values({ organizationId: session.organizationId, name, description: body?.description?.trim() || null, status: body?.publish ? "published" : "draft", currentVersion: 1 }).returning();
  if (!agent) return error(500, "CREATE_FAILED", "تعذر إنشاء الوكيل.", requestId);
  try {
    const [version] = await db().insert(agentVersions).values({ agentId: agent.id, version: 1, providerCredentialId, model, instructions }).returning();
    if (!version) throw new Error("VERSION_CREATE_FAILED");
    await db().insert(auditLogs).values({ organizationId: session.organizationId, actorType: "user", actorId: session.userId, action: "agent.created", resourceType: "agent", resourceId: agent.id, metadata: { model, published: body?.publish === true } });
    return NextResponse.json({ success: true, data: { agent, version }, meta: { requestId } }, { status: 201 });
  } catch (cause) {
    await db().delete(agents).where(eq(agents.id, agent.id)).catch(() => undefined);
    console.error(JSON.stringify({ event: "agent.create.failed", requestId, error: cause instanceof Error ? cause.name : "unknown" }));
    return error(500, "CREATE_FAILED", "تعذر حفظ إصدار الوكيل.", requestId);
  }
}

export async function PATCH(request: Request) {
  const requestId = id(request);
  const session = await currentSession().catch(() => null);
  if (!session?.organizationId || !session.role) return error(401, "UNAUTHORIZED", "يجب تسجيل الدخول.", requestId);
  if (!writeRoles.has(session.role)) return error(403, "FORBIDDEN", "لا تملك صلاحية تعديل الوكيل.", requestId);
  const body = await request.json().catch(() => null) as { id?: string; status?: "draft" | "published" | "archived" } | null;
  if (!body?.id || !body.status || !["draft", "published", "archived"].includes(body.status)) return error(400, "VALIDATION_ERROR", "المعرّف والحالة مطلوبان.", requestId);
  const [updated] = await db().update(agents).set({ status: body.status, updatedAt: new Date() }).where(and(eq(agents.id, body.id), eq(agents.organizationId, session.organizationId))).returning();
  if (!updated) return error(404, "NOT_FOUND", "الوكيل غير موجود.", requestId);
  return NextResponse.json({ success: true, data: updated, meta: { requestId } });
}
