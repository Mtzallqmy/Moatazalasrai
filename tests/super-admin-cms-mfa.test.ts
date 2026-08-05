import { describe, expect, it } from "vitest";
import { contentOperationSchema, sectionPayloadSchema } from "@/lib/admin/content-contracts";
import {
  decodeBase32,
  encodeBase32,
  generateRecoveryCodes,
  hashRecoveryCode,
  totpCode,
  verifyTotp,
} from "@/lib/security/totp";

describe("MFA primitives", () => {
  it("round-trips base32 secrets", () => {
    const source = Buffer.from("12345678901234567890", "ascii");
    const encoded = encodeBase32(source);
    expect(encoded).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(decodeBase32(encoded)).toEqual(source);
  });

  it("matches RFC 6238 SHA1 vectors after six-digit truncation", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const step = Math.floor(59 / 30);
    expect(totpCode(secret, step)).toBe("287082");
    expect(verifyTotp({ secret, code: "287082", now: 59_000, window: 0 })).toBe(step);
  });

  it("prevents reuse of an accepted TOTP step", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const now = 59_000;
    const code = totpCode(secret, 1);
    expect(verifyTotp({ secret, code, now, window: 0, lastUsedStep: 0 })).toBe(1);
    expect(verifyTotp({ secret, code, now, window: 0, lastUsedStep: 1 })).toBeNull();
  });

  it("creates unique, normalized recovery codes", () => {
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(hashRecoveryCode(codes[0])).toBe(hashRecoveryCode(codes[0].toLowerCase().replaceAll("-", " ")));
  });
});

describe("structured CMS contracts", () => {
  it("accepts a safe structured hero", () => {
    expect(sectionPayloadSchema.parse({
      type: "hero",
      content: {
        heading: "منصة عمليات ذكية",
        body: "تشغيل آمن وقابل للتوسع.",
        primaryAction: { label: "ابدأ", href: "/login" },
        imageUrl: "https://cdn.example.com/hero.webp",
      },
    }).type).toBe("hero");
  });

  it("rejects unsafe protocols and unstructured HTML", () => {
    expect(() => sectionPayloadSchema.parse({
      type: "hero",
      content: { heading: "عنوان", primaryAction: { label: "خطر", href: "javascript:alert(1)" } },
    })).toThrow();
    expect(() => sectionPayloadSchema.parse({
      type: "rich_text",
      content: { html: "<script>alert(1)</script>" },
    })).toThrow();
  });

  it("requires a page or safe URL for menu items", () => {
    expect(() => contentOperationSchema.parse({
      operation: "menu_item.upsert",
      menuId: "00000000-0000-4000-8000-000000000001",
      key: "empty",
      label: "فارغ",
      href: null,
      pageId: null,
    })).toThrow();
    expect(contentOperationSchema.parse({
      operation: "menu_item.upsert",
      menuId: "00000000-0000-4000-8000-000000000001",
      key: "about",
      label: "من نحن",
      href: "/about",
      pageId: null,
    }).operation).toBe("menu_item.upsert");
  });
});
