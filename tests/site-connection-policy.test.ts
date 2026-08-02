import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_PERMISSION_POLICIES,
  evaluateSitePermission,
  permissionRequiresMandatoryApproval,
} from "@/lib/site-connections/policy";
import { normalizeDomainAllowlist } from "@/lib/site-connections/domains";

 describe("site connection policy", () => {
  it("uses safe defaults without a full-access mode", () => {
    expect(DEFAULT_SITE_PERMISSION_POLICIES.read).toBe("allow");
    expect(DEFAULT_SITE_PERMISSION_POLICIES.navigate).toBe("allow");
    expect(DEFAULT_SITE_PERMISSION_POLICIES.send).toBe("require_approval");
    expect(DEFAULT_SITE_PERMISSION_POLICIES.payment).toBe("deny");
    expect(Object.keys(DEFAULT_SITE_PERMISSION_POLICIES)).not.toContain("full_access");
  });

  it("forces approval for high-risk send and delete actions", () => {
    expect(evaluateSitePermission({ action: "send", configuredPolicy: "allow", risk: "high" }).outcome).toBe("require_approval");
    expect(evaluateSitePermission({ action: "delete", configuredPolicy: "allow", risk: "critical" }).outcome).toBe("require_approval");
    expect(permissionRequiresMandatoryApproval("delete", "high")).toBe(true);
  });

  it("never allows critical payment or security changes without approval", () => {
    expect(evaluateSitePermission({ action: "payment", configuredPolicy: "allow", risk: "critical" }).outcome).toBe("require_approval");
    expect(evaluateSitePermission({ action: "security_settings", configuredPolicy: "deny", risk: "critical" }).outcome).toBe("deny");
  });

  it("normalizes and deduplicates domain allowlists", () => {
    expect(normalizeDomainAllowlist("Example.COM.", ["api.example.com", "example.com", "API.EXAMPLE.COM."]))
      .toEqual(["example.com", "api.example.com"]);
  });

  it("rejects wildcard and local domains", () => {
    expect(() => normalizeDomainAllowlist("example.com", ["*.example.com"])).toThrow();
    expect(() => normalizeDomainAllowlist("localhost", [])).toThrow();
  });
});
