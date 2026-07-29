import { ApiError } from "@/lib/http/api";

export async function integrationFetch(
  url: string,
  init: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "MoatazAgentPlatform/1.0",
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "INTEGRATION_TIMEOUT", "انتهت مهلة الاتصال بخدمة التكامل.");
    }
    throw new ApiError(502, "INTEGRATION_UNAVAILABLE", "تعذر الاتصال بخدمة التكامل.");
  } finally {
    clearTimeout(timeout);
  }
}
