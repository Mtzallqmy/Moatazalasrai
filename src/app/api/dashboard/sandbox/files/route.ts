import { z } from "zod";
import { requireSession } from "@/lib/auth/authorization";
import {
  sandboxFileDeleteSchema,
  sandboxFileListSchema,
  sandboxFileReadSchema,
  sandboxFileWriteSchema,
} from "@/lib/sandbox/contracts";
import {
  deleteSandboxFile,
  listSandboxFiles,
  readSandboxFile,
  writeSandboxFile,
} from "@/lib/sandbox/service";
import {
  apiSuccess,
  assertSameOrigin,
  getRequestId,
  handleApiError,
  parseJson,
} from "@/lib/http/api";
import { hydrateRuntimeControlPlane } from "@/lib/platform/runtime-control";

const querySchema = z.discriminatedUnion("mode", [
  sandboxFileListSchema.extend({ mode: z.literal("list") }),
  sandboxFileReadSchema.extend({ mode: z.literal("read") }),
]);

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    await hydrateRuntimeControlPlane();
    const session = await requireSession("sandbox:read");
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const actor = { organizationId: session.organizationId, userId: session.userId, role: session.role };
    const result = query.mode === "list"
      ? await listSandboxFiles({ actor, workspaceId: query.workspaceId, path: query.path, depth: query.depth })
      : await readSandboxFile({ actor, workspaceId: query.workspaceId, path: query.path, maxBytes: query.maxBytes });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/sandbox/files");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    await hydrateRuntimeControlPlane();
    const session = await requireSession("sandbox:manage");
    const body = await parseJson(request, sandboxFileWriteSchema, 3 * 1024 * 1024);
    const result = await writeSandboxFile({
      actor: { organizationId: session.organizationId, userId: session.userId, role: session.role },
      workspaceId: body.workspaceId,
      path: body.path,
      content: body.content,
      encoding: body.encoding,
      overwrite: body.overwrite,
      requestId,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/sandbox/files");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    await hydrateRuntimeControlPlane();
    const session = await requireSession("sandbox:manage");
    const body = await parseJson(request, sandboxFileDeleteSchema, 8 * 1024);
    const result = await deleteSandboxFile({
      actor: { organizationId: session.organizationId, userId: session.userId, role: session.role },
      workspaceId: body.workspaceId,
      path: body.path,
      recursive: body.recursive,
      requestId,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/sandbox/files");
  }
}
