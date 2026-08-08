import { requireSession } from "@/lib/auth/authorization";
import { ExecutionError, executionErrorHttpStatus } from "@/lib/execution/errors";
import { listExecutionEvents } from "@/lib/execution/event-service";
import { getExecutionForActor } from "@/lib/execution/repository";
import { assertExecutionKernelEnabled } from "@/lib/execution/runner-registry";
import { TERMINAL_EXECUTION_STATUSES } from "@/lib/execution/states";
import { ApiError, getRequestId, handleApiError } from "@/lib/http/api";
import { uuidSchema } from "@/lib/http/contracts";

const encoder = new TextEncoder();

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function GET(request: Request, context: { params: Promise<{ executionId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertExecutionKernelEnabled();
    const session = await requireSession("executions:read");
    const executionId = uuidSchema.parse((await context.params).executionId);
    const actor = { organizationId: session.organizationId, userId: session.userId, role: session.role };
    await getExecutionForActor(actor, executionId);
    const url = new URL(request.url);
    const headerCursor = Number(request.headers.get("last-event-id") ?? 0);
    const queryCursor = Number(url.searchParams.get("after") ?? 0);
    let cursor = Math.max(
      Number.isSafeInteger(headerCursor) && headerCursor >= 0 ? headerCursor : 0,
      Number.isSafeInteger(queryCursor) && queryCursor >= 0 ? queryCursor : 0,
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const send = (value: string) => {
          if (!closed) controller.enqueue(encoder.encode(value));
        };
        send("retry: 2000\n\n");
        void (async () => {
          const startedAt = Date.now();
          let lastHeartbeatAt = 0;
          try {
            while (!request.signal.aborted && Date.now() - startedAt < 55_000) {
              const events = await listExecutionEvents({
                organizationId: session.organizationId,
                jobId: executionId,
                after: cursor,
                limit: 200,
              });
              for (const event of events) {
                cursor = event.sequence;
                send(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify({
                  sequence: event.sequence,
                  type: event.type,
                  source: event.source,
                  level: event.level,
                  payload: event.payload,
                  createdAt: event.createdAt,
                })}\n\n`);
              }
              if (Date.now() - lastHeartbeatAt >= 10_000) {
                send(`: heartbeat ${new Date().toISOString()}\n\n`);
                lastHeartbeatAt = Date.now();
              }
              const scoped = await getExecutionForActor(actor, executionId);
              if (TERMINAL_EXECUTION_STATUSES.has(scoped.job.status) && events.length === 0) break;
              await delay(2_000, request.signal);
            }
          } catch (error) {
            send(`event: error\ndata: ${JSON.stringify({ code: "EXECUTION_EVENTS_UNAVAILABLE", requestId })}\n\n`);
            console.error(JSON.stringify({
              level: "error",
              event: "execution.events.stream_failed",
              requestId,
              executionId,
              errorName: error instanceof Error ? error.name : "UNKNOWN",
            }));
          } finally {
            closed = true;
            controller.close();
          }
        })();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-store, must-revalidate",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    if (error instanceof ExecutionError) {
      return handleApiError(new ApiError(executionErrorHttpStatus(error.code), error.code, error.message), requestId, "/api/executions/[executionId]/events");
    }
    return handleApiError(error, requestId, "/api/executions/[executionId]/events");
  }
}
