import { NextResponse, type NextRequest } from "next/server";
import { isPuterEnabled } from "@/lib/puter/feature";
import { consumeRateLimit, requestClientKey } from "@/lib/security/rate-limit";

function applySecurityHeaders(response: NextResponse, nonce: string, requestId: string) {
  response.headers.set("x-request-id", requestId);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()");
  response.headers.set("cross-origin-opener-policy", "same-origin");
  response.headers.set("cross-origin-resource-policy", "same-origin");
  response.headers.set("origin-agent-cluster", "?1");
  response.headers.set("x-permitted-cross-domain-policies", "none");
  if (process.env.NODE_ENV === "production") {
    response.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains; preload");
  }
  response.headers.set("content-security-policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    `connect-src 'self' https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com https://challenges.cloudflare.com${isPuterEnabled() ? " https://api.puter.com wss://api.puter.com" : ""}`,
    "frame-src https://challenges.cloudflare.com",
    ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
  ].join("; "));
  return response;
}

export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const nonce = btoa(crypto.randomUUID());
  const existing = requestHeaders.get("x-request-id");
  const requestId = existing && /^[a-zA-Z0-9._:-]{1,100}$/.test(existing)
    ? existing
    : crypto.randomUUID();
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-nonce", nonce);
  const cfRay = request.headers.get("cf-ray")?.trim();
  if (cfRay && /^[a-zA-Z0-9-]{1,100}$/.test(cfRay)) requestHeaders.set("x-cf-ray", cfRay);

  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/") && pathname !== "/api/health" && pathname !== "/api/ready") {
    try {
      const result = await consumeRateLimit({
        scope: "api.global.ip",
        key: requestClientKey(request, "unknown"),
        limit: 600,
        windowMs: 60_000,
      });
      if (!result.allowed) {
        const limited = NextResponse.json({
          error: { code: "RATE_LIMITED", message: "عدد الطلبات كبير. حاول مرة أخرى لاحقًا.", requestId },
        }, { status: 429 });
        limited.headers.set("retry-after", String(result.retryAfter));
        return applySecurityHeaders(limited, nonce, requestId);
      }
    } catch {
      if (process.env.NODE_ENV === "production") {
        const unavailable = NextResponse.json({
          error: { code: "RATE_LIMIT_BACKEND_UNAVAILABLE", message: "خدمة الحماية من كثرة الطلبات غير متاحة.", requestId },
        }, { status: 503 });
        return applySecurityHeaders(unavailable, nonce, requestId);
      }
    }
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/api/") || ["/login", "/register", "/select-organization"].includes(pathname)) {
    response.headers.set("cache-control", "private, no-store, max-age=0");
    response.headers.set("cdn-cache-control", "no-store");
    response.headers.set("cloudflare-cdn-cache-control", "no-store");
  }
  return applySecurityHeaders(response, nonce, requestId);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
