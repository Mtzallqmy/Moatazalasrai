import { describe, expect, it, vi } from "vitest";
import {
  NotificationProviderError,
  sendEmailNotification,
  sendPushNotification,
} from "@/lib/notifications/providers";

describe("notification providers", () => {
  it("sends a plain-text email through Resend without leaking credentials", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer test-key" });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        from: "Platform <notifications@example.com>",
        to: ["user@example.com"],
        subject: "عنوان",
        text: "المحتوى",
      });
      return new Response(JSON.stringify({ id: "email-1" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await expect(sendEmailNotification({
      to: "user@example.com",
      subject: "عنوان",
      body: "المحتوى",
      apiKey: "test-key",
      from: "Platform <notifications@example.com>",
      fetchImpl: fetchImpl as typeof fetch,
    })).resolves.toEqual({ messageId: "email-1" });
  });

  it("classifies rate limits as retryable", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "limited" }), { status: 429 }));
    await expect(sendEmailNotification({
      to: "user@example.com",
      subject: "عنوان",
      body: "المحتوى",
      apiKey: "test-key",
      from: "notifications@example.com",
      fetchImpl: fetchImpl as typeof fetch,
    })).rejects.toMatchObject({ code: "PROVIDER_HTTP_429", retryable: true });
  });

  it("sends Expo push notifications and rejects invalid tokens", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        to: "ExponentPushToken[abcdefgh12345678]",
        title: "تنبيه",
        body: "حدث جديد",
      });
      return new Response(JSON.stringify({ data: { status: "ok", id: "push-1" } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await expect(sendPushNotification({
      token: "ExponentPushToken[abcdefgh12345678]",
      title: "تنبيه",
      body: "حدث جديد",
      fetchImpl: fetchImpl as typeof fetch,
    })).resolves.toEqual({ messageId: "push-1" });
    await expect(sendPushNotification({ token: "invalid", title: "x", body: "y" }))
      .rejects.toBeInstanceOf(NotificationProviderError);
  });
});
