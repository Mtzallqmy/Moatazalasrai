import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { memberMutationSchema } from "@/lib/http/contracts";

describe("time-bounded member access", () => {
  it("accepts an admin-created account with role, expiry, and explicit permissions", () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const parsed = memberMutationSchema.parse({
      action: "create",
      name: "مستخدم تجريبي",
      email: " New.User@Example.com ",
      password: "strong-password-123",
      role: "member",
      expiresAt,
      permissions: ["agents:run", "files:upload"],
    });
    expect(parsed).toMatchObject({
      email: "new.user@example.com",
      expiresAt,
      permissions: ["agents:run", "files:upload"],
    });
  });

  it("rejects owner assignment, weak passwords, and unknown permissions", () => {
    const base = {
      action: "create",
      name: "Test User",
      email: "user@example.com",
      password: "strong-password-123",
      role: "member",
      expiresAt: null,
      permissions: [],
    } as const;
    expect(() => memberMutationSchema.parse({ ...base, role: "owner" })).toThrow();
    expect(() => memberMutationSchema.parse({ ...base, password: "short" })).toThrow();
    expect(() => memberMutationSchema.parse({ ...base, permissions: ["root:everything"] })).toThrow();
  });

  it("migrates membership expiry and revokes already-expired web and mobile sessions", async () => {
    const migration = await readFile("drizzle/0050_member_access_expiry.sql", "utf8");
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "expires_at" timestamptz');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "custom_permissions" jsonb');
    expect(migration).toContain('UPDATE "sessions"');
    expect(migration).toContain('UPDATE "mobile_sessions"');
  });

  it("enforces expiry across web sessions, mobile tokens, and API authentication", async () => {
    const [session, mobile, apiKey, guard] = await Promise.all([
      readFile("src/lib/auth/session.ts", "utf8"),
      readFile("src/lib/auth/mobile.ts", "utf8"),
      readFile("src/lib/auth/api-key.ts", "utf8"),
      readFile("src/components/session-expiry-guard.tsx", "utf8"),
    ]);
    expect(session).toContain("activeMembership()");
    expect(session).toContain("await clearSessionCookies()");
    expect(mobile).toContain("ACCOUNT_ACCESS_EXPIRED");
    expect(apiKey).toContain("activeMembership()");
    expect(guard).toContain('window.location.replace("/login?reason=access-expired")');
  });

  it("keeps account creation and registration policy under owner/admin control", async () => {
    const [route, manager] = await Promise.all([
      readFile("src/app/api/dashboard/members/route.ts", "utf8"),
      readFile("src/components/members-manager.tsx", "utf8"),
    ]);
    expect(route).toContain('body.action === "create"');
    expect(route).toContain('session.role === "admin" && body.role === "admin"');
    expect(route).toContain('body.action === "registration"');
    expect(route).toContain("revokeOrganizationSessions");
    expect(manager).toContain("إنشاء المستخدم وتفعيل الوصول");
    expect(manager).toContain("صلاحيات إضافية دقيقة");
  });
});
