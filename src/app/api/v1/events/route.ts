import { z } from "zod";
import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { publishDomainEvent } from "@/lib/events/publish";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const eventSchema = z.object({
  eventKey: z.string().trim().min(3).max(120).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/),
  resourceType: z.string().trim().min(2).max(100).regex(/^[a-z0-9_.-]+$/).optional(),
  resourceId: z.string().trim().min(1).max(200).optional(),
  idempotencyKey: z.string().trim().min(8).max(240).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
}).strict();

const SENSITIVE_KEY = /(?:password|passphrase|secret|token|authorization|cookie|cvv|card_number|otp|one_time|private_key|access_key)/i;

function assertSafePayload(value: unknown, path = "payload", depth = 0) {
  if (depth > 8) throw new ApiError(422, "EVENT_PAYLOAD_TOO_DEEP", "حمولة الحدث متداخلة أكثر من الحد المسموح.");
  if (Array.isArray(value)) {
    if (value.length > 500) throw new ApiError(422, "EVENT_PAYLOAD_TOO_LARGE", "قائمة داخل حمولة الحدث أكبر من الحد المسموح.");
    value.forEach((item, index) => assertSafePayload(item, `${path}.${index}`, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") return;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 200) throw new ApiError(422, "EVENT_PAYLOAD_TOO_LARGE", "حمولة الحدث تحتوي حقولًا أكثر من الحد المسموح.");
  for (const [key, child] of entries) {
    if (SENSITIVE_KEY.test(key)) {
      throw new ApiError(422, "EVENT_SENSITIVE_FIELD_BLOCKED", `لا يمكن نشر الحقل الحساس ${path}.${key}.`);
    }
    assertSafePayload(child, `${path}.${key}`, depth + 1);
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "events:write");
    await enforceRateLimit({
      scope: "api.events.publish",
      key: `${principal.organizationId}:${principal.principalId}`,
      limit: 600,
      windowMs: 60_000,
    });
    const body = await parseJson(request, eventSchema, 128 * 1024);
    assertSafePayload(body.payload);
    const event = await publishDomainEvent({
      organizationId: principal.organizationId,
      eventKey: body.eventKey,
      actorType: principal.kind,
      actorId: principal.principalId,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      payload: body.payload,
      idempotencyKey: body.idempotencyKey,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
    });
    return apiSuccess({ id: event.id, eventKey: event.eventKey, queued: true }, requestId, 202);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/events");
  }
}
