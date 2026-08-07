import { credentialProxyRequestSchema, proxyCredentialRequest, verifyCredentialProxySignature } from "@/lib/execution/credential-proxy-service";
import { ExecutionError, executionErrorHttpStatus } from "@/lib/execution/errors";
import { assertExecutionKernelEnabled } from "@/lib/execution/runner-registry";
import { ApiError, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 2 * 1024 * 1024 + 16 * 1024;

async function readBody(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "طلب Proxy أكبر من الحد المسموح.");
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "طلب Proxy أكبر من الحد المسموح.");
  return body;
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertExecutionKernelEnabled();
    const body = await readBody(request);
    const pathname = new URL(request.url).pathname;
    const verified = verifyCredentialProxySignature({
      timestamp: request.headers.get("x-moataz-timestamp"),
      nonce: request.headers.get("x-moataz-nonce"),
      service: request.headers.get("x-moataz-service"),
      bodyHash: request.headers.get("x-moataz-body-sha256"),
      signature: request.headers.get("x-moataz-signature"),
      method: request.method,
      pathname,
      body,
    });
    if (!verified) throw new ApiError(401, "EXECUTION_PROXY_UNAUTHORIZED", "فشل التحقق من هوية Runner.");
    let json: unknown;
    try { json = JSON.parse(body); } catch { throw new ApiError(400, "INVALID_JSON", "جسم طلب Proxy غير صالح."); }
    const input = credentialProxyRequestSchema.parse(json);
    const result = await proxyCredentialRequest(input);
    return apiSuccess({
      status: result.status,
      headers: result.headers,
      bodyBase64: Buffer.from(result.body).toString("base64"),
      bytes: result.bytes,
    }, requestId);
  } catch (error) {
    if (error instanceof ExecutionError) {
      return handleApiError(new ApiError(executionErrorHttpStatus(error.code), error.code, error.message), requestId, "/api/internal/execution/egress");
    }
    return handleApiError(error, requestId, "/api/internal/execution/egress");
  }
}
