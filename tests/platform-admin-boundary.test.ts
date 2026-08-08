import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { ALL_PERMISSIONS, permissionsFor } from "@/lib/auth/permissions";
import { controlPlaneOperationSchema } from "@/lib/control-plane/contracts";
import { whatsappPolicyUpdateSchema } from "@/lib/channels/whatsapp-policy-admin";

const root = process.cwd();

describe("platform operations security boundary", () => {
  test("tenant roles never inherit platform permissions", () => {
    const tenantPermissions = new Set<string>(ALL_PERMISSIONS);
    expect(tenantPermissions.has("platform:read")).toBe(false);
    expect(tenantPermissions.has("platform:manage")).toBe(false);
    expect(tenantPermissions.has("platform:admins:manage")).toBe(false);
    expect(tenantPermissions.has("platform:secrets:manage")).toBe(false);
    expect(permissionsFor("owner").some((permission) => permission.startsWith("platform:"))).toBe(false);
    expect(permissionsFor("admin").some((permission) => permission.startsWith("platform:"))).toBe(false);
  });

  test("custom tenant roles cannot grant a platform privilege", () => {
    const parsed = controlPlaneOperationSchema.safeParse({
      operation: "role.upsert",
      key: "tenant-admin-plus",
      name: "Tenant Admin Plus",
      enabled: true,
      permissions: ["platform:manage"],
    });
    expect(parsed.success).toBe(false);
  });

  test("tenant WhatsApp policy API cannot mutate platform defaults", async () => {
    expect(whatsappPolicyUpdateSchema.safeParse({ scope: "platform", status: "active" }).success).toBe(false);
    const manager = await readFile(`${root}/src/components/whatsapp-policy-manager.tsx`, "utf8");
    const service = await readFile(`${root}/src/lib/channels/whatsapp-policy-admin.ts`, "utf8");
    expect(manager).not.toContain('option value="platform"');
    expect(service).not.toContain('input.update.scope === "platform"');
  });

  test("global runtime controls are guarded by independent platform authorization", async () => {
    const runtime = await readFile(`${root}/src/app/api/platform-admin/runtime-control/route.ts`, "utf8");
    const whatsapp = await readFile(`${root}/src/app/api/platform-admin/whatsapp-runtime/route.ts`, "utf8");
    const legacyRuntime = await readFile(`${root}/src/app/api/dashboard/runtime-control/route.ts`, "utf8");
    const legacyWhatsapp = await readFile(`${root}/src/app/api/dashboard/whatsapp-runtime/route.ts`, "utf8");
    expect(runtime).toContain('requirePlatformPermission("platform:manage"');
    expect(runtime).not.toContain('requireSession("organization:manage")');
    expect(whatsapp).toContain('requirePlatformPermission("platform:manage"');
    expect(whatsapp).not.toContain('requireSession("organization:manage")');
    expect(legacyRuntime).toContain("@/app/api/platform-admin/runtime-control/route");
    expect(legacyWhatsapp).toContain("@/app/api/platform-admin/whatsapp-runtime/route");
  });

  test("platform authorization requires MFA proof for the current session and recent reauth for sensitive changes", async () => {
    const source = await readFile(`${root}/src/lib/auth/platform-authorization.ts`, "utf8");
    expect(source).toContain("PLATFORM_MFA_REQUIRED");
    expect(source).toContain("PLATFORM_MFA_SESSION_REQUIRED");
    expect(source).toContain("PLATFORM_REAUTH_REQUIRED");
    expect(source).toContain("reauthenticated_at");
    expect(source).toContain("requireRecentReauthentication");
  });

  test("tenant settings and diagnostics do not render global runtime control panels", async () => {
    const settings = await readFile(`${root}/src/app/dashboard/settings/page.tsx`, "utf8");
    const diagnostics = await readFile(`${root}/src/app/dashboard/diagnostics/page.tsx`, "utf8");
    expect(settings).not.toContain("WhatsAppRuntimeStatus");
    expect(diagnostics).not.toContain("ProductionControlCenter");
    expect(diagnostics).not.toContain("WhatsAppRuntimeStatus");
  });

  test("platform identity is structurally separate from organization membership", async () => {
    const migration = await readFile(`${root}/drizzle/0047_platform_security_boundaries.sql`, "utf8");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "platform_admins"');
    const platformAdminBlock = migration.split('CREATE TABLE IF NOT EXISTS "platform_admins"')[1]?.split(");")[0] ?? "";
    expect(platformAdminBlock).not.toContain("organization_id");
    expect(platformAdminBlock).toContain('"user_id" uuid PRIMARY KEY');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "platform_admin_audit_logs"');
  });
});
