import { NextResponse, type NextRequest } from "next/server";
import { isPuterEnabled } from "@/lib/puter/feature";

export function proxy(request: NextRequest) {
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
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  response.headers.set("content-security-policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    `connect-src 'self' https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com https://challenges.cloudflare.com${isPuterEnabled() ? " https://api.puter.com wss://api.puter.com" : ""}`,
    "frame-src https://challenges.cloudflare.com",
    ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
  ].join("; "));
  if (request.nextUrl.pathname.startsWith("/dashboard") || request.nextUrl.pathname.startsWith("/api/") || ["/login", "/register", "/select-organization"].includes(request.nextUrl.pathname)) {
    response.headers.set("cache-control", "private, no-store, max-age=0");
    response.headers.set("cdn-cache-control", "no-store");
    response.headers.set("cloudflare-cdn-cache-control", "no-store");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
