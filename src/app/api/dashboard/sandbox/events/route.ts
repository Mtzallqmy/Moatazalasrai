import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sandboxExecutions } from "@/db/sandbox-schema";
import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { hydrateRuntimeControlPlane } from "@/lib/platform/runtime-control";
import { sandboxEventsQuerySchema } from "@/lib/sandbox/contracts";
import { listSandboxEvents } from "@/lib/sandbox/events";
import { assertSandboxEnabled } from "@/lib/sandbox/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const terminal = new Set(["completed", "failed", "cancelled", "timed_out"]);

async function assertExecutionAccess(input: {
  organizationId: string;
  userId: string;
  role: string;
  executionId: string;
}) {
  const [execution] = await db().select({
    id: sandboxExecutions.id,
    status: sandboxExecutions.status,
  }).from(sandboxExecutions).where(and(
    eq(sandboxExecutions.id, input.executionId),
    eq(sandboxExecutions.organizationId, input.organizationId),
    input.role === "member" ? eq(sandboxExecutions.requestedByUserId, input.userId) : undefined,
  )).limit(1);
  if (!execution) return null;
  return execution;
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    await hydrateRuntimeControlPlane();
    const session = await requireSession("sandbox:read");
    assertSandboxEnabled();
    const url = new URL(request.url);
    const query = sandboxEventsQuerySchema.parse(Object.fromEntries(url.searchParams));
    const execution = await assertExecutionAccess({
      organizationId: session.organizationId,
      userId: session.userId,
      role: session.role,
      executionId: query.executionId,
    });
    if (!execution) {
      return new Response(JSON.stringify({ success: false, error: { code: "SANDBOX_EXECUTION_NOT_FOUND", message: "عملية Sandbox غير موجودة.", requestId } }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-request-id": requestId },
      });
    }

    const streamRequested = request.headers.get("accept")?.includes("text/event-stream") || url.searchParams.get("stream") === "1";
    if (!streamRequested) {
      const rows = await listSandboxEvents({
        organizationId: session.organizationId,
        executionId: query.executionId,
        after: query.after,
        limit: query.limit,
      });
      return apiSuccess({ events: rows, status: execution.status }, requestId);
    }

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          try { controller.close(); } catch {}
        };
        request.signal.addEventListener("abort", close, { once: true });
        void (async () => {
          let after = query.after;
          const deadline = Date.now() + 25_000;
          controller.enqueue(encoder.encode(`retry: 1000\nevent: ready\ndata: ${JSON.stringify({ requestId, after })}\n\n`));
          while (!closed && Date.now() < deadline) {
            const events = await listSandboxEvents({
              organizationId: session.organizationId,
              executionId: query.executionId,
              after,
              limit: query.limit,
            });
            for (const event of events) {
              after = event.sequence;
              controller.enqueue(encoder.encode(
                `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify({ ...event, createdAt: event.createdAt.toISOString() })}\n\n`,
              ));
            }
            const [state] = await db().select({ status: sandboxExecutions.status }).from(sandboxExecutions).where(and(
              eq(sandboxExecutions.id, query.executionId),
              eq(sandboxExecutions.organizationId, session.organizationId),
            )).limit(1);
            if (!state || terminal.has(state.status)) {
              controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify({ status: state?.status ?? "missing", after })}\n\n`));
              break;
            }
            if (events.length === 0) controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
            await new Promise((resolve) => setTimeout(resolve, 750));
          }
          close();
        })().catch((error) => {
          if (!closed) {
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ code: "STREAM_ERROR", message: error instanceof Error ? error.message : "stream failed" })}\n\n`));
          }
          close();
        });
      },
      cancel() {},
    });
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/sandbox/events");
  }
}
