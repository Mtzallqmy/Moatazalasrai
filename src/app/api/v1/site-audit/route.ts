import { z } from "zod";
import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { validateProviderBaseUrl } from "@/lib/security/provider-network";
import { storeAttachment } from "@/lib/storage/attachments";

export const runtime = "nodejs";

const schema = z.object({
  conversationId: z.string().uuid(),
  url: z.string().url().max(2048),
  authorized: z.literal(true),
}).strict();

function titleOf(html: string) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
}

async function fetchPublicPage(initialUrl: string) {
  let current = initialUrl;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const safe = await validateProviderBaseUrl(current);
    const response = await fetch(safe.normalizedUrl, {
      redirect: "manual",
      headers: { "user-agent": "Moataz-AI-Site-Auditor/1.0", accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(20_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new ApiError(502, "SITE_REDIRECT_INVALID", "أعاد الموقع تحويلًا بلا عنوان صالح.");
    current = new URL(location, safe.normalizedUrl).toString();
  }
  throw new ApiError(422, "SITE_REDIRECT_LIMIT", "تجاوز الموقع حد التحويلات الآمن.");
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "رمز الوصول غير صالح.", requestId);
    requireApiScope(principal, "files:write");
    const body = await parseJson(request, schema, 12 * 1024);
    const safeUrl = await validateProviderBaseUrl(body.url);
    const startedAt = Date.now();
    const response = await fetchPublicPage(safeUrl.normalizedUrl);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > 2_000_000) throw new ApiError(413, "SITE_RESPONSE_TOO_LARGE", "حجم صفحة الفحص أكبر من الحد الآمن.");
    const html = (await response.text()).slice(0, 2_000_000);
    const headers = Object.fromEntries([
      "content-security-policy",
      "strict-transport-security",
      "x-content-type-options",
      "x-frame-options",
      "referrer-policy",
      "permissions-policy",
    ].map((name) => [name, response.headers.get(name)]));
    const findings = [
      !headers["content-security-policy"] && "لا يوجد Content-Security-Policy.",
      !headers["strict-transport-security"] && "لا يوجد Strict-Transport-Security.",
      !headers["x-content-type-options"] && "لا يوجد X-Content-Type-Options.",
      !headers["x-frame-options"] && "لا يوجد X-Frame-Options.",
      !/<meta[^>]+name=[\"']viewport[\"']/i.test(html) && "وسم viewport غير ظاهر في HTML.",
      !/<html[^>]+lang=/i.test(html) && "لغة المستند غير محددة على عنصر html.",
      !/<meta[^>]+name=[\"']description[\"']/i.test(html) && "وصف الصفحة meta description غير ظاهر.",
      (html.match(/<img\b/gi)?.length ?? 0) > (html.match(/<img\b[^>]*\balt=/gi)?.length ?? 0)
        && "بعض الصور لا تحتوي على نص بديل alt.",
    ].filter(Boolean);
    const report = {
      target: safeUrl.normalizedUrl,
      finalUrl: response.url,
      status: response.status,
      durationMs: Date.now() - startedAt,
      title: titleOf(html),
      contentType: response.headers.get("content-type"),
      htmlBytesInspected: Buffer.byteLength(html),
      securityHeaders: headers,
      pageSignals: {
        headings: html.match(/<h[1-6]\b/gi)?.length ?? 0,
        links: html.match(/<a\b/gi)?.length ?? 0,
        images: html.match(/<img\b/gi)?.length ?? 0,
        forms: html.match(/<form\b/gi)?.length ?? 0,
      },
      findings,
      note: "فحص دفاعي غير هجومي لصفحة عامة واحدة وبموافقة المستخدم.",
    };
    const file = await storeAttachment({
      organizationId: principal.organizationId,
      conversationId: body.conversationId,
      uploadedByUserId: principal.userId ?? undefined,
      restrictConversationToUserId: principal.userId ?? undefined,
      source: "api",
      filename: `site-audit-${Date.now()}.json`,
      mimeType: "application/json",
      content: Buffer.from(JSON.stringify(report, null, 2), "utf8"),
    });
    return apiSuccess({ file, report }, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/site-audit");
  }
}
