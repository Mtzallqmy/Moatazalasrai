import { describe, expect, it } from "vitest";
import { isNonEmptyTitle, cn } from "@/lib/utils";

describe("isNonEmptyTitle", () => {
  it("accepts a non-empty string", () => {
    expect(isNonEmptyTitle("مهمة جديدة")).toBe(true);
  });

  it("rejects empty/whitespace-only strings", () => {
    expect(isNonEmptyTitle("")).toBe(false);
    expect(isNonEmptyTitle("   ")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isNonEmptyTitle(42)).toBe(false);
    expect(isNonEmptyTitle(null)).toBe(false);
    expect(isNonEmptyTitle(undefined)).toBe(false);
  });
});

describe("cn", () => {
  it("joins truthy class names and drops falsy ones", () => {
    expect(cn("a", false, "b", null, undefined, "c")).toBe("a b c");
  });
});
