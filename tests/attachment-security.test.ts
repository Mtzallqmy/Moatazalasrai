import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createAttachmentDownloadToken,
  verifyAttachmentDownloadToken,
} from "@/lib/storage/attachment-signing";
import { parseClamAvResponse } from "@/server/files/antivirus";

const attachmentId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";

describe("private attachment signing", () => {
  beforeEach(() => {
    process.env.ATTACHMENT_SIGNING_SECRET = "test-attachment-signing-secret-at-least-32-chars";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ATTACHMENT_SIGNING_SECRET;
  });

  test("binds the organization and attachment into a short-lived token", () => {
    const signed = createAttachmentDownloadToken({
      attachmentId,
      organizationId,
      ttlSeconds: 60,
    });
    expect(verifyAttachmentDownloadToken(signed.token)).toMatchObject({
      attachmentId,
      organizationId,
      disposition: "attachment",
    });
    expect(signed.expiresAt.toISOString()).toBe("2026-08-05T00:01:00.000Z");
  });

  test("rejects tampering and expired links", () => {
    const signed = createAttachmentDownloadToken({ attachmentId, organizationId, ttlSeconds: 30 });
    expect(() => verifyAttachmentDownloadToken(`${signed.token.slice(0, -1)}A`)).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_LINK_INVALID" }),
    );
    vi.advanceTimersByTime(31_000);
    expect(() => verifyAttachmentDownloadToken(signed.token)).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_LINK_EXPIRED" }),
    );
  });
});

describe("ClamAV response handling", () => {
  test("accepts clean responses and quarantines malware signatures", () => {
    expect(parseClamAvResponse("stream: OK\0")).toEqual({ verdict: "clean", engine: "clamav" });
    expect(parseClamAvResponse("stream: Eicar-Test-Signature FOUND\0")).toEqual({
      verdict: "infected",
      engine: "clamav",
      signature: "Eicar-Test-Signature",
    });
  });

  test("fails closed on an unknown scanner response", () => {
    expect(() => parseClamAvResponse("unexpected response")).toThrow("CLAMAV_RESPONSE_INVALID");
  });
});
