import { describe, expect, it } from "vitest";
import {
  analyzeSandboxCommand,
  evaluateSandboxPolicy,
  normalizeWorkspacePath,
  redactSandboxText,
} from "@/lib/sandbox/policy";

 describe("sandbox policy engine", () => {
  it("allows a bounded read-only command when explicitly allowed", () => {
    const decision = evaluateSandboxPolicy({ action: "exec", configuredPolicy: "allow", command: "node --version", timeoutMs: 10_000, networkMode: "disabled" });
    expect(decision.outcome).toBe("allow");
    expect(decision.risk).toBe("low");
  });

  it("requires approval for destructive file commands", () => {
    const decision = evaluateSandboxPolicy({ action: "exec", configuredPolicy: "allow", command: "rm -rf dist", timeoutMs: 10_000, networkMode: "disabled" });
    expect(decision.outcome).toBe("require_approval");
    expect(decision.reasons).toContain("destructive_filesystem_change");
  });

  it("denies broad deletion even when exec is allowed", () => {
    const decision = evaluateSandboxPolicy({ action: "exec", configuredPolicy: "allow", command: "rm -rf /", timeoutMs: 10_000, networkMode: "disabled" });
    expect(decision.outcome).toBe("deny");
    expect(decision.risk).toBe("critical");
  });

  it("denies environment and credential access", () => {
    expect(evaluateSandboxPolicy({ action: "exec", configuredPolicy: "allow", command: "printenv", networkMode: "disabled" }).outcome).toBe("deny");
    expect(evaluateSandboxPolicy({ action: "exec", configuredPolicy: "allow", command: "cat ~/.ssh/id_rsa", networkMode: "disabled" }).outcome).toBe("deny");
  });

  it("denies network commands while networking is disabled", () => {
    const analysis = analyzeSandboxCommand("curl https://example.com", 30_000);
    expect(analysis.requiresNetwork).toBe(true);
    expect(evaluateSandboxPolicy({ action: "exec", configuredPolicy: "allow", command: "curl https://example.com", networkMode: "disabled" }).outcome).toBe("deny");
  });

  it("still requires approval for package installation with an allowlist", () => {
    const decision = evaluateSandboxPolicy({ action: "exec", configuredPolicy: "allow", command: "npm install lodash", networkMode: "allowlist" });
    expect(decision.outcome).toBe("require_approval");
    expect(decision.risk).toBe("high");
  });

  it("blocks workspace path traversal", () => {
    expect(() => normalizeWorkspacePath("../../etc/passwd")).toThrow(/خارج مساحة العمل/);
    expect(() => normalizeWorkspacePath("foo\\bar")).toThrow(/غير صالح/);
    expect(normalizeWorkspacePath("src/../README.md")).toBe("README.md");
  });

  it("redacts token-like output", () => {
    const value = redactSandboxText("Authorization: Bearer abc.def token api_key=secret");
    expect(value).not.toContain("abc.def");
    expect(value).not.toContain("secret");
    expect(value).toContain("[redacted]");
  });
});
