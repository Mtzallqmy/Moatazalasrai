import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Supabase Auth and R2 architecture", () => {
  it("keeps authorization in Railway and links only the external subject", async () => {
    const [migration, sessionConstraintMigration, identity] = await Promise.all([
      readFile("drizzle/0052_supabase_auth_identity.sql", "utf8"),
      readFile("drizzle/0053_supabase_session_conflict_constraint.sql", "utf8"),
      readFile("src/lib/auth/supabase-identity.ts", "utf8"),
    ]);
    expect(migration).toContain('"supabase_user_id"');
    expect(migration).not.toMatch(/organizations|custom_permissions|member_role/i);
    expect(identity).toContain("organizationMembers");
    expect(identity).toContain("publicRegistrationEnabled");
    expect(identity).not.toContain("user_metadata?.role");
    expect(identity).toContain("OWNER_EMAIL");
    expect(identity).toContain('role: "owner"');
    expect(sessionConstraintMigration).toContain('ON "sessions" ("supabase_session_id")');
    expect(sessionConstraintMigration).not.toMatch(/where\s+"supabase_session_id"\s+is\s+not\s+null/i);
  });

  it("uses direct signed R2 upload and defers file processing to the worker", async () => {
    const [route, queue, task] = await Promise.all([
      readFile("src/app/api/dashboard/files/presigned/route.ts", "utf8"),
      readFile("src/worker/queue.ts", "utf8"),
      readFile("src/worker/tasks/attachment-process.ts", "utf8"),
    ]);
    expect(route).toContain("createSignedUploadUrl");
    expect(route).toContain("enqueueAttachmentProcess");
    expect(queue).toContain('addJob("attachment-process"');
    expect(task).toContain("processStoredAttachment");
  });
});
