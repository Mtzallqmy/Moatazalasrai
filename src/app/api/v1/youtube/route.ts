import { z } from "zod";
import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { storeAttachment } from "@/lib/storage/attachments";

export const runtime = "nodejs";

const schema = z.object({
  conversationId: z.string().uuid(),
  url: z.string().url().max(2048),
}).strict();

function youtubeUrl(value: string) {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!["youtube.com", "m.youtube.com", "youtu.be"].includes(hostname)) {
    throw new ApiError(422, "YOUTUBE_URL_REQUIRED", "أدخل رابط YouTube صالحًا.");
  }
  return parsed.toString();
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "رمز الوصول غير صالح.", requestId);
    requireApiScope(principal, "files:write");
    const body = await parseJson(request, schema, 12 * 1024);
    const endpoint = process.env.YOUTUBE_TRANSCRIPT_API_URL?.trim();
    if (!endpoint) {
      throw new ApiError(
        503,
        "YOUTUBE_TRANSCRIPT_PROVIDER_REQUIRED",
        "موصل تفريغ YouTube غير مهيأ. أضف YOUTUBE_TRANSCRIPT_API_URL في Railway أو اربط أداة MCP للتفريغ.",
      );
    }
    const endpointUrl = new URL(endpoint);
    if (endpointUrl.protocol !== "https:") {
      throw new ApiError(500, "YOUTUBE_TRANSCRIPT_PROVIDER_INSECURE", "يجب أن يستخدم موصل التفريغ HTTPS.");
    }
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json",
        ...(process.env.YOUTUBE_TRANSCRIPT_API_KEY
          ? { authorization: `Bearer ${process.env.YOUTUBE_TRANSCRIPT_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({ url: youtubeUrl(body.url) }),
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      throw new ApiError(502, "YOUTUBE_TRANSCRIPT_PROVIDER_FAILED", "تعذر تفريغ المقطع عبر الموصل المحدد.", {
        providerStatus: response.status,
      });
    }
    const transcript = [payload?.transcript, payload?.text, payload?.data && (payload.data as Record<string, unknown>).transcript]
      .find((value) => typeof value === "string" && value.trim().length > 0);
    if (typeof transcript !== "string") {
      throw new ApiError(502, "YOUTUBE_TRANSCRIPT_EMPTY", "لم يُرجع موصل التفريغ نصًا صالحًا.");
    }
    const file = await storeAttachment({
      organizationId: principal.organizationId,
      conversationId: body.conversationId,
      uploadedByUserId: principal.userId ?? undefined,
      restrictConversationToUserId: principal.userId ?? undefined,
      source: "api",
      filename: `youtube-transcript-${Date.now()}.txt`,
      mimeType: "text/plain",
      content: Buffer.from(`المصدر: ${body.url}\n\n${transcript.slice(0, 500_000)}`, "utf8"),
    });
    return apiSuccess({ file }, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/youtube");
  }
}
