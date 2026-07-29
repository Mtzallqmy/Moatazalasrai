import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const existing = requestHeaders.get("x-request-id");
  const requestId = existing && /^[a-zA-Z0-9._:-]{1,100}$/.test(existing)
    ? existing
    : crypto.randomUUID();
  requestHeaders.set("x-request-id", requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  if (request.nextUrl.pathname.startsWith("/dashboard")) {
    response.headers.set("cache-control", "private, no-store, max-age=0");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
