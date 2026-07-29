import { describe, expect, it } from "vitest";
import { can } from "@/lib/auth/authorization";

describe("RBAC policy", () => {
  it("keeps secrets away from operators and viewers", () => {
    expect(can("operator", "providers:manage")).toBe(false);
    expect(can("viewer", "providers:manage")).toBe(false);
    expect(can("operator", "providers:read")).toBe(true);
  });

  it("allows operators to run but not edit agents", () => {
    expect(can("operator", "agents:run")).toBe(true);
    expect(can("operator", "agents:manage")).toBe(false);
  });

  it("reserves membership and audit management", () => {
    expect(can("admin", "members:manage")).toBe(true);
    expect(can("developer", "members:read")).toBe(false);
    expect(can("viewer", "audit:read")).toBe(false);
  });
});
